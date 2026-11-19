// Climbing II, phase 4: the rope's clips (the owner's Swinging folder: `Hanging.fbx`, `Climbing A Rope.fbx`, `Start
// Swinging.fbx`, and the four let-goes into a landing) and what the game reads of them.
//
// The owner's frames (DESIGN-CLIMB2.md's clip table, at 30 a second): `hanging` the still hang (2.583 s, a loop);
// `climbing_a_rope` the climb up (2.55 s, a loop; played backward for down: there is no down clip); `start_swinging` usable
// from 32 (1.07 s: the feet off the ground, both hands on the rope) to its end (2.033 s), its swing played by the pendulum's
// own angle as the bar's swing is; and the let-goes (item 4, maker B): `swinging` level from 31 (1.03), `swing_to_land_1`
// knee high from 40 (1.33), `swing_to_land` between knee and waist from 31 (1.03), `swing_into_wall` waist high, the feet to
// the wall, from 28 (0.93). The import's report agrees with his lengths: 78, 77, 62, 74, 62, 66 and 92 frames.
//
// What the rope plays is measured off the rig's own fit of each clip once, at the first frame on a rope (`measureRopeTables`,
// through `CharacterRig.sampleJoints`): each clip's grip (the hands' mean) and hips in the rig root's frame a sample a time,
// the hips' angle and distance about the grip, and over the swing's window that angle made never to fall (the bars' way), so a
// pendulum's angle finds one time of the window. The figure is drawn with its clip's grip on the rope's grip and turned about
// its own left so its hips stand on the rope's line below the grip (src/player/ropeSwing.ts's `placeFigure`).
//
// Pure: numbers and names only.

/** The still hang (a loop). */
export const ROPE_HANG = 'hanging';
/** The climb up (a loop; backward for down). */
export const ROPE_CLIMB = 'climbing_a_rope';
/** Getting on and swinging (a one-off: its swing from `ROPE_TIMES.swingFrom` played by the pendulum's angle). */
export const ROPE_SWING = 'start_swinging';
/** The let-goes into a landing, by the lip's height under the body (phase 4's item 4, maker B). */
export const ROPE_LAND_LEVEL = 'swinging';
export const ROPE_LAND_KNEE = 'swing_to_land_1';
export const ROPE_LAND_BETWEEN = 'swing_to_land';
export const ROPE_LAND_WAIST = 'swing_into_wall';

/** Every clip the ropes ask the pack for (`PackIo.also`, beside the bars'). */
export const ROPE_IDS: readonly string[] = [ROPE_HANG, ROPE_CLIMB, ROPE_SWING, ROPE_LAND_LEVEL, ROPE_LAND_KNEE, ROPE_LAND_BETWEEN, ROPE_LAND_WAIST];

/** Each one's rig name (the pack's `mx_` prefix), made once (nothing names a clip anew on a frame). */
export const ROPE_CLIP_NAMES: Readonly<Record<string, string>> = Object.fromEntries(ROPE_IDS.map((id) => [id, `mx_${id}`]));

/**
 * The swing's twin (`CharacterRig.twinClip`, made once a rig): the swing played by the pendulum's angle is a held one-off on
 * the rig, and a swing taken up again after a climb or a still hang is crossfaded from the one before, which one action cannot
 * be into itself. The swing alternates between the clip and its twin (src/player/ropeSwing.ts's `swingName`).
 */
export const ROPE_SWING_TWIN = `${ROPE_CLIP_NAMES[ROPE_SWING]}~2`;

/** The owner's seconds (his frames at 30 a second), each held to the clip's own measure by climbRopes.test.ts. */
export const ROPE_TIMES = {
  /** The swing's window starts (frame 32: the feet off the ground, both hands on the rope). */
  swingFrom: 32 / 30,
  /** And ends at the clip's own last frame (2.033 s). */
  swingTo: 61 / 30,
  /** The let-goes (item 4): the release frames the owner named. */
  landLevel: 31 / 30,
  landKnee: 40 / 30,
  landBetween: 31 / 30,
  landWaist: 28 / 30,
  /**
   * Maker B: the level clip's foot touching (his frame 37), where the level landing goes on from at the arrival, and the frame
   * before it, which the flight holds while it flies on longer than the clip's own stretch from its let-go (the Smoothness III
   * rule: a clip's airborne stretch fitted to the flight, its frames just before the touch held).
   */
  levelTouch: 37 / 30,
  levelHold: 36 / 30,
} as const;

/**
 * Maker B, item 4: the landings by the lip's height under the feet where the flight meets it, in order: level, knee, between knee
 * and waist, waist. Each one's clip and the second it is played from at the arrival (the level one from its foot's touch, its let-go
 * and flight being the flight's own; the rest from the let-go frame the owner named).
 */
export const ROPE_BAND_LEVEL = 0;
export const ROPE_BAND_KNEE = 1;
export const ROPE_BAND_BETWEEN = 2;
export const ROPE_BAND_WAIST = 3;
export const ROPE_BAND_IDS: readonly string[] = [ROPE_LAND_LEVEL, ROPE_LAND_KNEE, ROPE_LAND_BETWEEN, ROPE_LAND_WAIST];
export const ROPE_BAND_NAMES: readonly string[] = ['level', 'knee', 'between', 'waist'];
export const ROPE_BAND_FROM: readonly number[] = [ROPE_TIMES.levelTouch, ROPE_TIMES.landKnee, ROPE_TIMES.landBetween, ROPE_TIMES.landWaist];
/** Each band's clip by its rig name, made once. */
export const ROPE_BAND_CLIPS: readonly string[] = ROPE_BAND_IDS.map((id) => `mx_${id}`);
/** The flight's clip (the level landing's own, from its let-go), by its rig name. */
export const ROPE_FLIGHT_CLIP = `mx_${ROPE_LAND_LEVEL}`;
/**
 * Maker B: measured on the human male (the pack's clips fitted to him; climbRopesLand.test.ts measures them again), by band: how
 * far the lower foot reaches ahead of the hips at the landing's start (metres: the landing begins with the hips that far from the
 * face, the capsule's own radius at the least), and the second each clip's feet are stood (its lower ankle within a few
 * centimetres of its last height from there on: the carry onto the top lasts from the band's start to there).
 */
export const ROPE_LAND_FACTS: { readonly reach: readonly number[]; readonly stand: readonly number[] } = {
  reach: [0.34, 0.168, 0.401, 0.719],
  stand: [1.275, 1.333, 1.558, 2.717],
};
/** The joints a landing's table is measured off: the hips (the skeleton's root) and the two ankles. */
export const ROPE_LAND_JOINTS: readonly string[] = ['', 'lAnkle', 'rAnkle'];
/** A lower ankle within this of its last height is stood (a landing's `stand`): a mechanic, a sole's own settling. */
const STAND_WITHIN = 0.04;

/** A landing's pose at a time: the hips and the lower ankle, in the clip's own frame. */
export class RopeLandPose {
  hx = 0.5;
  hy = 0.5;
  hz = 0.5;
  ax = 0.5;
  ay = 0.5;
  az = 0.5;
  constructor() {
    this.hx = 0;
    this.hy = 0;
    this.hz = 0;
    this.ax = 0;
    this.ay = 0;
    this.az = 0;
  }
}

/**
 * Maker B: one clip of the let-go measured off a rig from `t0` to `t1` (its hips and its lower ankle a sample a time), with what
 * the landing reads of it: how far its braced foot reaches ahead of its hips at `t0` (`reach`: where the landing begins, that far
 * from the face), and when its feet are stood (`stand`: the lower ankle within `STAND_WITHIN` of its last height from there on).
 */
export class RopeLandTable {
  readonly t0: number;
  readonly n: number;
  readonly hx: Float64Array;
  readonly hy: Float64Array;
  readonly hz: Float64Array;
  readonly ax: Float64Array;
  readonly ay: Float64Array;
  readonly az: Float64Array;
  reach = 0.5;
  stand = 0.5;
  /** The frame's ask (a field, so no number crosses a call on a frame): a time, seconds into the clip. */
  ask = 0.5;
  constructor(n: number, t0: number) {
    this.n = n;
    this.t0 = t0;
    this.hx = new Float64Array(n);
    this.hy = new Float64Array(n);
    this.hz = new Float64Array(n);
    this.ax = new Float64Array(n);
    this.ay = new Float64Array(n);
    this.az = new Float64Array(n);
    this.reach = 0;
    this.stand = t0;
    this.ask = t0;
  }

  /** The table from `ROPE_LAND_JOINTS`' samples at `times` (the rig root's frame), null where they make nothing. */
  static build(samples: Float64Array, times: Float64Array): RopeLandTable | null {
    const n = times.length;
    if (n < 2 || samples.length < n * 9) return null;
    const T = new RopeLandTable(n, times[0]);
    for (let i = 0; i < n; i++) {
      const k = i * 9;
      T.hx[i] = samples[k];
      T.hy[i] = samples[k + 1];
      T.hz[i] = samples[k + 2];
      const left = samples[k + 4] <= samples[k + 7];
      T.ax[i] = left ? samples[k + 3] : samples[k + 6];
      T.ay[i] = left ? samples[k + 4] : samples[k + 7];
      T.az[i] = left ? samples[k + 5] : samples[k + 8];
    }
    T.reach = T.az[0] - T.hz[0];
    const last = T.ay[n - 1];
    let s = n - 1;
    while (s > 0 && Math.abs(T.ay[s - 1] - last) <= STAND_WITHIN) s--;
    T.stand = times[s];
    return T;
  }

  /** The table at `ask` (held to its own span) into `out`, between its two samples. */
  atAsk(out: RopeLandPose): void {
    let f = (this.ask - this.t0) / ROPE_TABLE_STEP;
    if (!(f > 0)) f = 0;
    if (f > this.n - 1) f = this.n - 1;
    const i = Math.min(this.n - 2, Math.floor(f));
    const u = f - i;
    out.hx = this.hx[i] + (this.hx[i + 1] - this.hx[i]) * u;
    out.hy = this.hy[i] + (this.hy[i + 1] - this.hy[i]) * u;
    out.hz = this.hz[i] + (this.hz[i + 1] - this.hz[i]) * u;
    out.ax = this.ax[i] + (this.ax[i + 1] - this.ax[i]) * u;
    out.ay = this.ay[i] + (this.ay[i + 1] - this.ay[i]) * u;
    out.az = this.az[i] + (this.az[i + 1] - this.az[i]) * u;
  }

  /** `atAsk` with the time handed in (the tests' and an event's). */
  at(t: number, out: RopeLandPose): void {
    this.ask = t;
    this.atAsk(out);
  }
}

/** Maker B: the let-go's tables a rig plays: the flight's (the level clip from its let-go to its touch) and each band's landing. */
export interface RopeLandTables {
  fly: RopeLandTable;
  land: RopeLandTable[];
}

/** Maker B: the let-go's clips measured off a rig once (its own fit), null where the rig has not them (yet: asked again). */
export function measureRopeLandTables(rig: RopeRig): RopeLandTables | null {
  const one = (name: string, t0: number, t1: number): RopeLandTable | null => {
    const d = rig.clipDuration(name);
    if (d === null) return null;
    const times = RopeTable.times(Math.min(t0, d), t1 > 0 ? Math.min(t1, d) : d);
    const samples = new Float64Array(times.length * 9);
    if (!rig.sampleJoints(name, ROPE_LAND_JOINTS, times, samples)) return null;
    return RopeLandTable.build(samples, times);
  };
  const fly = one(ROPE_FLIGHT_CLIP, ROPE_TIMES.landLevel, ROPE_TIMES.levelTouch);
  if (!fly) return null;
  const land: RopeLandTable[] = [];
  for (let b = 0; b < ROPE_BAND_CLIPS.length; b++) {
    const T = one(ROPE_BAND_CLIPS[b], ROPE_BAND_FROM[b], 0);
    if (!T) return null;
    land.push(T);
  }
  return { fly, land };
}

/** The table's step between two samples, seconds (four to a frame of the clip's own 30). */
export const ROPE_TABLE_STEP = 1 / 120;

/** What the figure plays on a rope (src/player/ropeSwing.ts's `mode`, which the rig's hand-over reads): the still hang, the climb, the swing. */
export const ROPE_MODE_HANG = 0;
export const ROPE_MODE_CLIMB = 1;
export const ROPE_MODE_SWING = 2;

/**
 * Measured on the human male (the pack's clips fitted to him; climbRopes.test.ts measures them again): the still hang's hips
 * under its grip (what the body hangs at, scaled by the figure: the rope's pendulum reaches the body's middle this far under
 * the hands), the grip over the lower ankle there (where a grab from the ground takes the rope), the climb's rise a cycle (each
 * hand's pull, summed: how far the body goes up the rope in one round of the clip), and the swing window's two ends' angles
 * (degrees, the hips about the grip, ahead positive).
 */
export const ROPE_FACTS = { hang: 0.709, grip: 2.0, climbRise: 0.552, from: -59.3, to: -19.3 } as const;

/** The joints the tables are measured off: the skeleton's root (the hips), each hand's wrist and index knuckle (the grip between them), and the ankles. */
export const ROPE_JOINTS: readonly string[] = ['', 'lWrist', 'lIndex01', 'rWrist', 'rIndex01', 'lAnkle', 'rAnkle'];

/** What a rig answers the tables' samples from (the rig's `sampleJoints`: src/player/rig.ts). */
export interface RopeRig {
  sampleJoints(clip: string, joints: readonly string[], times: ArrayLike<number>, out: Float64Array): boolean;
  clipDuration(clip: string): number | null;
}

/** A pose of a table at a time: the grip in the clip's frame, the hips' angle and distance about it, and the hips. */
export class RopePose {
  gx = 0.5;
  gy = 0.5;
  gz = 0.5;
  /** The hips' angle about the grip, radians: nought straight down, positive ahead (+z). */
  angle = 0.5;
  radius = 0.5;
  hx = 0.5;
  hy = 0.5;
  hz = 0.5;
  constructor() {
    this.gx = 0;
    this.gy = 0;
    this.gz = 0;
    this.angle = 0;
    this.radius = 0;
    this.hx = 0;
    this.hy = 0;
    this.hz = 0;
  }
}

/**
 * One clip measured off a rig from `t0` to `t1` (seconds into it): each sample's grip (the hands' mean), hips, and the hips'
 * angle and distance about the grip; the lower ankle's height under the grip; the mean pose over the whole (`mean`: what a
 * loop is drawn by, its own motion about it kept); and the angle made never to fall from its lowest sample on (`w0` to the
 * last: the swing's run, whose inverse is one time an angle).
 */
export class RopeTable {
  readonly t0: number;
  readonly n: number;
  readonly duration: number;
  readonly gx: Float64Array;
  readonly gy: Float64Array;
  readonly gz: Float64Array;
  readonly hx: Float64Array;
  readonly hy: Float64Array;
  readonly hz: Float64Array;
  readonly ang: Float64Array;
  readonly rad: Float64Array;
  /** The lower ankle's height under the grip, metres (positive). */
  readonly drop: Float64Array;
  /** The angle made never to fall from the lowest sample (`w0`) on (each sample the largest so far). */
  readonly mono: Float64Array;
  /** The lowest angle's sample: the never-falling run's first. */
  w0 = 0;
  /** The run's first and last angles, and the time the hips hang straight down (NaN where they never pass it). */
  from: number;
  to: number;
  still: number;
  /** The mean pose over the whole table (the grip, the hips' angle about it and their distance). */
  readonly meanPose = new RopePose();
  /** The climb's rise a round of its clip, metres (the climb's table only; `climbRiseOf`). */
  rise = 0.5;
  constructor(n: number, t0: number, duration: number) {
    this.n = n;
    this.t0 = t0;
    this.duration = duration;
    this.gx = new Float64Array(n);
    this.gy = new Float64Array(n);
    this.gz = new Float64Array(n);
    this.hx = new Float64Array(n);
    this.hy = new Float64Array(n);
    this.hz = new Float64Array(n);
    this.ang = new Float64Array(n);
    this.rad = new Float64Array(n);
    this.drop = new Float64Array(n);
    this.mono = new Float64Array(n);
    this.from = 0;
    this.to = 0;
    this.still = Number.NaN;
    this.rise = 0;
    this.ask = 0;
  }

  /** Sample times from `t0` to `t1` at the table's step (what a rig is asked to sample). */
  static times(t0: number, t1: number): Float64Array {
    const n = Math.max(2, Math.round((t1 - t0) / ROPE_TABLE_STEP) + 1);
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = Math.min(t1, t0 + i * ROPE_TABLE_STEP);
    return out;
  }

  /** The table from the joints' samples (`ROPE_JOINTS` at `times`, the rig root's own frame), null where they make nothing. */
  static build(samples: Float64Array, times: Float64Array, duration: number): RopeTable | null {
    const n = times.length;
    const nj = ROPE_JOINTS.length;
    if (n < 2 || samples.length < n * nj * 3) return null;
    const T = new RopeTable(n, times[0], duration);
    const at = (i: number, j: number, k: number) => samples[(i * nj + j) * 3 + k];
    for (let i = 0; i < n; i++) {
      const gx = (at(i, 1, 0) + at(i, 2, 0) + at(i, 3, 0) + at(i, 4, 0)) / 4;
      const gy = (at(i, 1, 1) + at(i, 2, 1) + at(i, 3, 1) + at(i, 4, 1)) / 4;
      const gz = (at(i, 1, 2) + at(i, 2, 2) + at(i, 3, 2) + at(i, 4, 2)) / 4;
      T.gx[i] = gx;
      T.gy[i] = gy;
      T.gz[i] = gz;
      T.hx[i] = at(i, 0, 0);
      T.hy[i] = at(i, 0, 1);
      T.hz[i] = at(i, 0, 2);
      const hy = at(i, 0, 1) - gy;
      const hz = at(i, 0, 2) - gz;
      T.ang[i] = Math.atan2(hz, -hy);
      T.rad[i] = Math.sqrt(hy * hy + hz * hz);
      T.drop[i] = gy - Math.min(at(i, 5, 1), at(i, 6, 1));
    }
    // The swing's run: from the lowest angle on, made never to fall.
    let w0 = 0;
    for (let i = 1; i < n; i++) if (T.ang[i] < T.ang[w0]) w0 = i;
    T.w0 = w0;
    let m = -Infinity;
    let still = Number.NaN;
    for (let i = 0; i < n; i++) {
      if (i >= w0) {
        m = Math.max(m, T.ang[i]);
        T.mono[i] = m;
      } else T.mono[i] = T.ang[w0];
      if (still !== still && i > 0 && T.ang[i - 1] < 0 && T.ang[i] >= 0) {
        const u = -T.ang[i - 1] / (T.ang[i] - T.ang[i - 1]);
        still = times[i - 1] + u * (times[i] - times[i - 1]);
      }
    }
    T.from = T.mono[w0];
    T.to = T.mono[n - 1];
    T.still = still;
    // The mean pose: the grip's mean and the hips' angle and distance about it at their mean place.
    const M = T.meanPose;
    M.gx = T.mean(T.gx);
    M.gy = T.mean(T.gy);
    M.gz = T.mean(T.gz);
    M.hx = T.mean(T.hx);
    M.hy = T.mean(T.hy);
    M.hz = T.mean(T.hz);
    const my = M.hy - M.gy;
    const mz = M.hz - M.gz;
    M.angle = Math.atan2(mz, -my);
    M.radius = Math.sqrt(my * my + mz * mz);
    return T;
  }

  /**
   * The frame's ask and answer (a field, so no number crosses a call on a frame): `timeOfAsk` reads an angle from it and writes the
   * time back; `atAsk` reads a time from it. `timeAt` and `at` are the same with the number handed in, for the tests and an event.
   */
  ask = 0.5;

  /** The time where the clip's hips stand at `ask` (radians) about its grip on the swing's run (`w0` on), held to its ends, into `ask`. */
  timeOfAsk(): void {
    const angle = this.ask;
    const M = this.mono;
    const last = this.n - 1;
    const w0 = this.w0;
    if (!(angle > M[w0])) {
      this.ask = this.t0 + w0 * ROPE_TABLE_STEP;
      return;
    }
    if (angle >= M[last]) {
      this.ask = this.t0 + last * ROPE_TABLE_STEP;
      return;
    }
    let lo = w0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (M[mid] <= angle) lo = mid;
      else hi = mid;
    }
    const d = M[hi] - M[lo];
    const u = d > 1e-12 ? (angle - M[lo]) / d : 0;
    this.ask = this.t0 + (lo + u) * ROPE_TABLE_STEP;
  }

  /** `timeOfAsk` with the angle handed in. */
  timeAt(angle: number): number {
    this.ask = angle;
    this.timeOfAsk();
    return this.ask;
  }

  /** The table at `ask` (seconds into the clip, held to the table's own span) into `out`, between its two samples. */
  atAsk(out: RopePose): void {
    let f = (this.ask - this.t0) / ROPE_TABLE_STEP;
    if (!(f > 0)) f = 0;
    if (f > this.n - 1) f = this.n - 1;
    const i = Math.min(this.n - 2, Math.floor(f));
    const u = f - i;
    out.gx = this.gx[i] + (this.gx[i + 1] - this.gx[i]) * u;
    out.gy = this.gy[i] + (this.gy[i + 1] - this.gy[i]) * u;
    out.gz = this.gz[i] + (this.gz[i + 1] - this.gz[i]) * u;
    out.angle = this.ang[i] + (this.ang[i + 1] - this.ang[i]) * u;
    out.radius = this.rad[i] + (this.rad[i + 1] - this.rad[i]) * u;
    out.hx = this.hx[i] + (this.hx[i + 1] - this.hx[i]) * u;
    out.hy = this.hy[i] + (this.hy[i + 1] - this.hy[i]) * u;
    out.hz = this.hz[i] + (this.hz[i + 1] - this.hz[i]) * u;
  }

  /** `atAsk` with the time handed in. */
  at(t: number, out: RopePose): void {
    this.ask = t;
    this.atAsk(out);
  }
  /** The mean over the table of a column (an event's arithmetic: the tests' and the facts'). */
  mean(col: Float64Array): number {
    let s = 0;
    for (let i = 0; i < this.n; i++) s += col[i];
    return s / this.n;
  }
}

/** The three tables a rig's rope plays: the still hang's, the climb's and the swing's (null where the rig has not the clips yet). */
export interface RopeTables {
  hang: RopeTable;
  climb: RopeTable;
  swing: RopeTable;
}

/**
 * The rope's three clips measured off a rig (its own fit: every skeleton's is its own), once, at the first frame on a rope; null
 * where the rig has not them (yet: asked again the next frame).
 */
export function measureRopeTables(rig: RopeRig): RopeTables | null {
  const one = (id: string, t0: number, t1: number): RopeTable | null => {
    const name = ROPE_CLIP_NAMES[id];
    const d = rig.clipDuration(name);
    if (d === null) return null;
    const end = t1 > 0 ? Math.min(t1, d) : d;
    const times = RopeTable.times(t0, end);
    const samples = new Float64Array(times.length * ROPE_JOINTS.length * 3);
    if (!rig.sampleJoints(name, ROPE_JOINTS, times, samples)) return null;
    return RopeTable.build(samples, times, d);
  };
  const hang = one(ROPE_HANG, 0, 0);
  const climb = one(ROPE_CLIMB, 0, 0);
  const swing = one(ROPE_SWING, ROPE_TIMES.swingFrom, ROPE_TIMES.swingTo);
  if (!hang || !climb || !swing) return null;
  const rise = climbRiseOf(rig);
  climb.rise = rise !== null && rise > 0.05 ? rise : ROPE_FACTS.climbRise;
  return { hang, climb, swing };
}

/**
 * The climb's rise a round of its clip (an event's arithmetic): the clip climbs in place, each hand reaching up once a round and
 * then coming down against the rig's root while it holds, so the way the body goes up the rope in one round is a hand's fall
 * from its highest to its lowest there (the mean of the two hands'). What the climb's phase is driven by (the body's way up the
 * rope over this is the share of a round the clip is put at), so a holding hand keeps its place on the rope whatever the climb's
 * speed. (Phase 5: `name` another climb's clip by its rig name, the pole's; the rope's unless given.)
 */
export function climbRiseOf(rig: RopeRig, name: string = ROPE_CLIP_NAMES[ROPE_CLIMB]): number | null {
  const d = rig.clipDuration(name);
  if (d === null) return null;
  const times = RopeTable.times(0, d);
  const joints = ['lWrist', 'rWrist'];
  const s = new Float64Array(times.length * 6);
  if (!rig.sampleJoints(name, joints, times, s)) return null;
  let lo0 = Infinity;
  let hi0 = -Infinity;
  let lo1 = Infinity;
  let hi1 = -Infinity;
  for (let i = 0; i < times.length; i++) {
    const l = s[i * 6 + 1];
    const r = s[i * 6 + 4];
    if (l < lo0) lo0 = l;
    if (l > hi0) hi0 = l;
    if (r < lo1) lo1 = r;
    if (r > hi1) hi1 = r;
  }
  return (hi0 - lo0 + (hi1 - lo1)) / 2;
}
