// The race drive's arithmetic, pure: the speed curve and the boost's, the speed shared out again after something
// took some of it, the travel's lag behind the nose, the yaw rate, the bank, the scaling that makes a bike out of a
// pod, the upgrades, the scrape-and-crash verdict, the walk along the ground ahead, the bridge over pits, one
// sub-step of the height rule, the strike's kick, the steep face, the rise too tall to clear in time and the slope's
// push. No page, no three, no physics: node runs it as it stands (`tools/swg/tests/raceMath.test.ts`), and
// `raceDrive.ts` is the only thing in the game that calls it.
//
// The shapes of the speed curve, the boost, the lag, the yaw rate and the slope's push are the shapes Star Wars:
// Racer's pods have, described in our own words; every number they are handed is ours, from `raceTune.ts`.

/** Everything a vehicle raced as a pod or a bike handles by, at one level of upgrades. Speeds in m/s, times in s, angles in degrees. */
export interface RaceBase {
  /** The plain top's asymptote at full upgrade (stock is `stockTop` of it), and the boost's own asymptote. */
  V: number;
  BT: number;
  /** The ceiling on horizontal speed, which nothing passes. */
  cap: number;
  /** The stock plain top as a share of `V`. */
  stockTop: number;
  /** Seconds to 75% of `V` from rest, the coast's and the air brake's time constants, the fastest it reverses. */
  t75: number;
  coast: number;
  brake: number;
  reverseTop: number;
  /** The boost: seconds of charge before it engages, seconds of boost the heat holds from cold, seconds to cool. */
  chargeTime: number;
  boostSeconds: number;
  coolSeconds: number;
  /** The travel's lag behind the nose (s), the most it turns (deg/s), the speed its steering is full at, how fast the turn comes on (deg/s²). */
  tau: number;
  maxTurn: number;
  turnFullAt: number;
  turnResponse: number;
  /** Bank into a turn and lean on the keys, and their eases. */
  bankMax: number;
  bankEase: number;
  leanMax: number;
  leanFrom: number;
  /** The height it is held at over the line, how far ahead the line looks and in what steps. */
  ride: number;
  lookMax: number;
  lookStep: number;
  /** Below the line it rises (riseRate a second, at most riseMax), within the band it settles (bandRate), above it falls. */
  riseRate: number;
  riseMax: number;
  band: number;
  bandRate: number;
  fall: number;
  fallMax: number;
  airborneAt: number;
  /** The longest piece of travel the height rule and the strike sweep take in one sub-step. */
  sweepStep: number;
  /** The fixed lengths the ground is judged over: a face met, a rise ahead, the slope under the hull. */
  faceLen: number;
  climbLen: number;
  climbGrade: number;
  slopeLen: number;
  /** A strike: sparks over this closing speed, hurt over this one, so much hull a m/s past it, never more than this. */
  strikeSpark: number;
  strikeHurt: number;
  strikeHull: number;
  strikeMost: number;
  /** A crash needs all three: the impact, the speed dropped, and the speed it came in at. */
  crashImpact: number;
  crashDrop: number;
  crashFrom: number;
  /** The box it collides as while it races, width, height and length (the shared one of its kind). */
  box: [number, number, number];
}

/** The speeds a bike is scaled by, and the ceiling's 'all': every one a speed in m/s. */
export const SPEED_KEYS = ['V', 'BT', 'cap', 'reverseTop', 'turnFullAt', 'leanFrom', 'strikeSpark', 'strikeHurt', 'crashImpact', 'crashDrop', 'crashFrom'] as const;
/** The two vertical speeds, scaled only for a bike: the ceiling's 'all' leaves them, since the body cap's room is measured against them. */
export const VERTICAL_KEYS = ['riseMax', 'fallMax'] as const;
/** The distances a speed reaches in a time, scaled with the speeds. */
export const DISTANCE_KEYS = ['lookMax', 'lookStep', 'faceLen', 'climbLen', 'slopeLen'] as const;
/** Every number of a base, in a fixed order (the box apart). */
export const BASE_KEYS = ['V', 'BT', 'cap', 'stockTop', 't75', 'coast', 'brake', 'reverseTop', 'chargeTime', 'boostSeconds', 'coolSeconds', 'tau', 'maxTurn', 'turnFullAt', 'turnResponse', 'bankMax', 'bankEase', 'leanMax', 'leanFrom', 'ride', 'lookMax', 'lookStep', 'riseRate', 'riseMax', 'band', 'bandRate', 'fall', 'fallMax', 'airborneAt', 'sweepStep', 'faceLen', 'climbLen', 'climbGrade', 'slopeLen', 'strikeSpark', 'strikeHurt', 'strikeHull', 'strikeMost', 'crashImpact', 'crashDrop', 'crashFrom'] as const;
export type RaceNumber = (typeof BASE_KEYS)[number];

/**
 * A base with nothing in it, to be written into (nothing in the drive makes one in a frame). Written out as one
 * literal with every number a fraction: built key by key in a loop, an object this size is kept by the engine as a
 * dictionary, and every number read out of it in a step was a number made.
 */
export function newBase(): RaceBase {
  const out: RaceBase = {
    V: 0.5,
    BT: 0.5,
    cap: 0.5,
    stockTop: 0.5,
    t75: 0.5,
    coast: 0.5,
    brake: 0.5,
    reverseTop: 0.5,
    chargeTime: 0.5,
    boostSeconds: 0.5,
    coolSeconds: 0.5,
    tau: 0.5,
    maxTurn: 0.5,
    turnFullAt: 0.5,
    turnResponse: 0.5,
    bankMax: 0.5,
    bankEase: 0.5,
    leanMax: 0.5,
    leanFrom: 0.5,
    ride: 0.5,
    lookMax: 0.5,
    lookStep: 0.5,
    riseRate: 0.5,
    riseMax: 0.5,
    band: 0.5,
    bandRate: 0.5,
    fall: 0.5,
    fallMax: 0.5,
    airborneAt: 0.5,
    sweepStep: 0.5,
    faceLen: 0.5,
    climbLen: 0.5,
    climbGrade: 0.5,
    slopeLen: 0.5,
    strikeSpark: 0.5,
    strikeHurt: 0.5,
    strikeHull: 0.5,
    strikeMost: 0.5,
    crashImpact: 0.5,
    crashDrop: 0.5,
    crashFrom: 0.5,
    box: [0.5, 0.5, 0.5],
  };
  for (const k of BASE_KEYS) out[k] = 0;
  out.box[0] = 0;
  out.box[1] = 0;
  out.box[2] = 0;
  return out;
}

/** Every number of `from` into `out`, the box's three included. */
export function copyBase(from: RaceBase, out: RaceBase): RaceBase {
  for (const k of BASE_KEYS) out[k] = from[k];
  out.box[0] = from.box[0];
  out.box[1] = from.box[1];
  out.box[2] = from.box[2];
  return out;
}

/**
 * Every speed and every distance a speed reaches in a time, times `k`; the vertical speeds too only when `vertical`;
 * the hull a strike costs a m/s divided by `k`, so the same share of speed costs the same hull. Every time, rate,
 * angle, share and acceleration is left as it was, and at `k` 1 every value is the base's own (`x * 1` is `x`).
 */
export function scaleSpeeds(base: RaceBase, k: number, vertical: boolean, out: RaceBase): RaceBase {
  copyBase(base, out);
  for (const key of SPEED_KEYS) out[key] = base[key] * k;
  if (vertical) for (const key of VERTICAL_KEYS) out[key] = base[key] * k;
  for (const key of DISTANCE_KEYS) out[key] = base[key] * k;
  out.strikeHull = base.strikeHull / k;
  return out;
}

/** What a bike has of its own, whatever it is scaled from: its ride, band, airborne height, sweep and box. */
export interface BikeSizes {
  ride: number;
  band: number;
  airborneAt: number;
  sweepStep: number;
  box: readonly [number, number, number];
}

/**
 * A racing bike made from the pod: every speed scaled by `s` (the owner's two ceilings), the vertical ones with
 * them, its own sizes laid over, and with `own` a set of numbers of its own laid over that (a bike that bites
 * where the pod drifts, `RACE_TUNE.bike: 'own'`).
 */
export function bikeFromPod(pod: RaceBase, s: number, sizes: BikeSizes, own: Partial<Record<RaceNumber, number>> | null, out: RaceBase): RaceBase {
  scaleSpeeds(pod, s, true, out);
  out.ride = sizes.ride;
  out.band = sizes.band;
  out.airborneAt = sizes.airborneAt;
  out.sweepStep = sizes.sweepStep;
  out.box[0] = sizes.box[0];
  out.box[1] = sizes.box[1];
  out.box[2] = sizes.box[2];
  if (own) for (const k of Object.keys(own) as RaceNumber[]) if (typeof own[k] === 'number') out[k] = own[k]!;
  return out;
}

/** The upgrade categories, in the order the console and the store name them. */
export const RACE_CATEGORIES = ['traction', 'turning', 'accel', 'top', 'airbrake', 'cooling', 'repair'] as const;
export type RaceCategory = (typeof RACE_CATEGORIES)[number];
export type RaceLevels = Record<RaceCategory, number>;
/** What full (level 5) does to each: a factor on its number, and for `top` the share of `V` it reaches. */
export type RaceUpgrades = Record<RaceCategory, number>;

/** Every category at a level. */
export function levelsAt(level: number): RaceLevels {
  const out = {} as RaceLevels;
  for (const c of RACE_CATEGORIES) out[c] = level;
  return out;
}

/** A vector's length. `Math.hypot` of three numbers gathers them into an array of its own on every call, which a step must not. */
export function len3(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

/** `a` toward `b` by `t`, exactly `a` at nought and exactly `b` at one. */
const lerp = (a: number, b: number, t: number): number => (t <= 0 ? a : t >= 1 ? b : a + (b - a) * t);
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

/**
 * The handling at a set of levels and a condition (reserved: 1 this pass): each category's factor applied as
 * `lerp(1, f, c·L/5)`, the plain top as the share of `V` lerped from the stock share to the full one. The base is
 * read and never written; `out` is rebuilt whole every time. Level 0 everywhere (or condition 0) is the stock table
 * to the bit.
 */
export function resolveRace(base: RaceBase, levels: Partial<RaceLevels>, condition: number, upgrades: RaceUpgrades, out: RaceBase): RaceBase {
  copyBase(base, out);
  const c = clamp(Number.isFinite(condition) ? condition : 1, 0, 1);
  const t = (cat: RaceCategory) => (c * clamp(Number.isFinite(levels[cat]) ? (levels[cat] as number) : 0, 0, 5)) / 5;
  out.tau = base.tau * lerp(1, upgrades.traction, t('traction'));
  out.turnResponse = base.turnResponse * lerp(1, upgrades.turning, t('turning'));
  out.t75 = base.t75 * lerp(1, upgrades.accel, t('accel'));
  out.V = base.V * lerp(base.stockTop, upgrades.top, t('top'));
  out.brake = base.brake * lerp(1, upgrades.airbrake, t('airbrake'));
  out.coolSeconds = base.coolSeconds * lerp(1, upgrades.cooling, t('cooling'));
  return out;
}

// ------------------------------------------------------------------------------------------------ speed and boost

/** The curve's constant from the seconds to 75% of the top: t(f) = A·f/(1 − f), so A = t75/3. */
export const thrustA = (t75: number): number => t75 / 3;
/** The most thrust the throttle builds: the curve reaches `thrustCap` of `V` there. */
export const thrustCapOf = (A: number, thrustCap: number): number => (thrustCap / (1 - thrustCap)) * A;

/** The curve's speed for a thrust: V·T/(A + T), and its mirror for a thrust below nought (reverse). */
export function speedOf(T: number, V: number, A: number): number {
  return T >= 0 ? (V * T) / (A + T) : (V * T) / (A - T);
}

/** The thrust the curve gives a speed at (the inverse): infinite at `V`, never asked past it by the drive. */
export function thrustFor(v: number, V: number, A: number): number {
  if (v >= 0) return v >= V ? Infinity : (A * v) / (V - v);
  const a = -v;
  return a >= V ? -Infinity : -(A * a) / (V - a);
}

/** The boost's speed for its charge B: BT·B/(B + half). */
export function boostOf(B: number, BT: number, half: number): number {
  return B > 0 ? (BT * B) / (B + half) : 0;
}

/** The boost's charge for a speed of it (the inverse). */
export function boostFor(b: number, BT: number, half: number): number {
  if (!(b > 0)) return 0;
  return b >= BT ? Infinity : (half * b) / (BT - b);
}

/** The four parts the speed is made of, besides the thrust and the boost's charge that give two of them. */
export interface SpeedParts {
  /** The thrust on the curve, and the boost's charge. */
  T: number;
  B: number;
  /** The slope's push (below nought uphill), and a speed the curve can no longer hold, easing down at the brake. */
  p: number;
  over: number;
}

/**
 * A horizontal speed `v` shared out again among the parts after something took some of it, or after the top fell
 * under it: the push keeps its value downhill up to `v` (cut to `v` if more) and whole uphill; the boost keeps its
 * share up to what is left (its charge set back through the boost curve's inverse); the curve takes the rest, held
 * under `thrustCap·V` so its thrust is finite and never reverse from a forward speed; anything above that is `over`.
 * The four sum to `v`. A backward speed is the curve's alone.
 */
export function shareSpeed(v: number, p: number, B: number, h: Pick<RaceBase, 'V' | 'BT' | 't75' | 'reverseTop'>, thrustCap: number, boostHalf: number, out: SpeedParts): SpeedParts {
  const A = thrustA(h.t75);
  const reverseT = -thrustFor(-h.reverseTop, h.V, A);
  if (v < 0) {
    out.T = Math.max(-reverseT, thrustFor(Math.max(v, -h.reverseTop), h.V, A));
    out.B = 0;
    out.p = 0;
    out.over = 0;
    return out;
  }
  const push = p > 0 ? Math.min(p, v) : p;
  let left = v - push;
  const b = boostOf(B, h.BT, boostHalf);
  const keep = Math.min(b, Math.max(0, left));
  out.B = keep === b ? B : boostFor(keep, h.BT, boostHalf);
  left -= keep;
  const r = Math.min(Math.max(0, left), thrustCap * h.V);
  out.T = Math.min(thrustCapOf(A, thrustCap), thrustFor(r, h.V, A));
  out.over = Math.max(0, left - r);
  out.p = push;
  return out;
}

// ------------------------------------------------------------------------------------------------ direction and turn

/** A horizontal unit vector, written in place. */
export interface Dir2 {
  x: number;
  z: number;
}

/**
 * The travel's direction blended toward the nose's by 1 − e^(−dt/τ): an exponential lag whatever the frame rate. A
 * part of the travel pointing back against the nose is taken off first. Writes `u`; a speed is never changed here.
 */
export function lagBlend(u: Dir2, noseX: number, noseZ: number, tau: number, dt: number): Dir2 {
  LAG.nx = noseX;
  LAG.nz = noseZ;
  LAG.tau = tau;
  LAG.dt = dt;
  lagBlendOf(u, LAG);
  return u;
}

/** A blend of the travel toward the nose as a record: the nose's direction, the time constant and the step's seconds. */
export interface LagStep {
  nx: number;
  nz: number;
  tau: number;
  dt: number;
}

export function newLagStep(): LagStep {
  return { nx: 0.5, nz: 0.5, tau: 0.5, dt: 0.5 };
}

const LAG = newLagStep();

/** `lagBlend` through a record, for the step: nothing crosses a call but the two records. */
export function lagBlendOf(u: Dir2, s: LagStep): void {
  const noseX = s.nx;
  const noseZ = s.nz;
  const back = u.x * noseX + u.z * noseZ;
  if (back < 0) {
    u.x -= back * noseX;
    u.z -= back * noseZ;
  }
  let l = Math.sqrt(u.x * u.x + u.z * u.z);
  if (!(l > 1e-9)) {
    u.x = noseX;
    u.z = noseZ;
    return;
  }
  u.x /= l;
  u.z /= l;
  const k = 1 - Math.exp(-s.dt / Math.max(1e-6, s.tau));
  u.x += (noseX - u.x) * k;
  u.z += (noseZ - u.z) * k;
  l = Math.sqrt(u.x * u.x + u.z * u.z);
  if (!(l > 1e-9)) {
    u.x = noseX;
    u.z = noseZ;
  } else {
    u.x /= l;
    u.z /= l;
  }
}
/** The yaw rate the stick asks for (deg/s, toward +heading): −maxTurn·sign(s)·s², nought inside the dead band. */
export function yawWanted(s: number, maxTurn: number, deadBand: number): number {
  if (Math.abs(s) < deadBand) return 0;
  return -maxTurn * Math.sign(s) * s * s;
}

/**
 * The yaw rate eased toward `target` at `response` (deg/s²), `reverseFactor` times quicker while it is still on the
 * wrong side of nought; `snap` (the stick changed sides) puts it to nought first.
 */
export function stepYawRate(w: number, target: number, response: number, reverseFactor: number, snap: boolean, dt: number): number {
  YAW.w = w;
  YAW.target = target;
  YAW.response = response;
  YAW.reverse = reverseFactor;
  YAW.snap = snap;
  YAW.dt = dt;
  stepYawRateOf(YAW);
  return YAW.w;
}

/** A step of the yaw rate as a record: the rate (stepped in place), what it is eased toward, how fast, the reverse factor, the snap and the seconds. */
export interface YawStep {
  w: number;
  target: number;
  response: number;
  reverse: number;
  snap: boolean;
  dt: number;
}

export function newYawStep(): YawStep {
  return { w: 0.5, target: 0.5, response: 0.5, reverse: 0.5, snap: false, dt: 0.5 };
}

const YAW = newYawStep();

/** `stepYawRate` through a record, for the step. */
export function stepYawRateOf(y: YawStep): void {
  const target = y.target;
  const response = y.response;
  let out = y.snap ? 0 : y.w;
  let left = y.dt;
  if (out !== 0 && target !== 0 && Math.sign(out) !== Math.sign(target)) {
    const rate = response * y.reverse;
    const toZero = Math.abs(out) / rate;
    if (toZero >= left) {
      y.w = out - Math.sign(out) * rate * left;
      return;
    }
    out = 0;
    left -= toZero;
  }
  const a = response * left;
  const d = target - out;
  y.w = out + (d < -a ? -a : d > a ? a : d);
}
/** The bank a yaw rate asks for (degrees; positive leans the right side down, into a right turn). */
export function bankTarget(w: number, maxTurn: number, bankMax: number): number {
  return clamp((-bankMax * w) / Math.max(1e-6, maxTurn), -bankMax, bankMax);
}

/** `from` eased toward `to` with a time constant, whatever the frame rate. */
export function ease(from: number, to: number, tau: number, dt: number): number {
  return from + (to - from) * (1 - Math.exp(-dt / Math.max(1e-6, tau)));
}

/** An angle into (−π, π]. */
export function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

// ------------------------------------------------------------------------------------------------ walls

/** What a step's lost velocity was: nothing, a scrape, or a crash. */
export const HIT_NONE = 0;
export const HIT_SCRAPE = 1;
export const HIT_CRASH = 2;

/**
 * Scrape or crash, by two measures: the impact (the whole velocity lost) and the speed dropped. A crash needs the
 * impact, the drop and the speed it came in at all past their numbers; anything else lost past `hitLoss` is a scrape.
 */
export function hitVerdict(cx: number, cy: number, cz: number, ax: number, ay: number, az: number, k: { hitLoss: number; crashImpact: number; crashDrop: number; crashFrom: number }): number {
  HIT_C.x = cx;
  HIT_C.y = cy;
  HIT_C.z = cz;
  HIT_A.x = ax;
  HIT_A.y = ay;
  HIT_A.z = az;
  return hitVerdictOf(HIT_C, HIT_A, k);
}
const HIT_C = { x: 0.5, y: 0.5, z: 0.5 };
const HIT_A = { x: 0.5, y: 0.5, z: 0.5 };

/** A three-number vector as anything carries it (a kept record, three's own, the engine's answer). */
export interface Vec3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * `hitVerdict` on the commanded and the actual velocity as they stand, so a step hands it two records and never six
 * numbers (a number handed to a call the compiler did not build in is a number made).
 */
export function hitVerdictOf(c: Vec3Like, a: Vec3Like, k: { hitLoss: number; crashImpact: number; crashDrop: number; crashFrom: number }): number {
  const ix = c.x - a.x;
  const iy = c.y - a.y;
  const iz = c.z - a.z;
  const impact = Math.sqrt(ix * ix + iy * iy + iz * iz);
  if (!(impact > k.hitLoss)) return HIT_NONE;
  const from = Math.sqrt(c.x * c.x + c.y * c.y + c.z * c.z);
  const drop = from - Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
  return impact >= k.crashImpact && drop >= k.crashDrop && from >= k.crashFrom ? HIT_CRASH : HIT_SCRAPE;
}

// ------------------------------------------------------------------------------------------------ the ground ahead

/**
 * What the ground ahead is read through: a built block only (`near`), and the far grid only at its own lattice
 * points (`far`), the lattice `farStep` apart and standing at `farX()`, `farZ()`. Neither ever makes anything.
 */
export interface LineReader {
  near(x: number, z: number): number | null;
  far(i: number, j: number): number | null;
  readonly farStep: number;
  farX(): number;
  farZ(): number;
}

/**
 * The far grid's lattice points the walk has read, kept by their integer place so a plan reads only the points it
 * has newly reached. A point the grid could not answer is kept as that too. Made once, written in place.
 */
export class LatticeRing {
  private readonly ii: Int32Array;
  private readonly jj: Int32Array;
  private readonly vals: Float64Array;
  private readonly used: Uint8Array;
  private next = 0;
  /** Lookups that missed the ring and went to the grid, ever (for the console and the test). */
  reads = 0;
  readonly size: number;
  constructor(size: number) {
    this.size = Math.max(1, Math.round(size));
    this.ii = new Int32Array(this.size);
    this.jj = new Int32Array(this.size);
    this.vals = new Float64Array(this.size);
    this.used = new Uint8Array(this.size);
  }
  /** The far grid's height at lattice point (i, j), from the ring or read once; NaN where the grid has none. */
  at(reader: LineReader, i: number, j: number): number {
    for (let k = 0; k < this.size; k++) if (this.used[k] && this.ii[k] === i && this.jj[k] === j) return this.vals[k];
    this.reads++;
    const v = reader.far(i, j);
    const slot = this.next;
    this.next = (this.next + 1) % this.size;
    this.ii[slot] = i;
    this.jj[slot] = j;
    this.vals[slot] = v === null || !Number.isFinite(v) ? Number.NaN : v;
    this.used[slot] = 1;
    return this.vals[slot];
  }
  clear(): void {
    this.used.fill(0);
    this.next = 0;
  }
}

/** One walk of the ground ahead: each sample's distance from the nose and the ground there, and the one past its end. */
export interface LineWalk {
  n: number;
  d: Float64Array;
  g: Float64Array;
  /** Where each sample stands, for the far ray. */
  x: Float64Array;
  z: Float64Array;
  /** The sample one step past the walk's reach (NaN where there is none), and its distance. */
  past: number;
  pastD: number;
  /** How far the walk meant to reach, and how far it got before the cache stopped answering. */
  reach: number;
  got: number;
  /** Where the next walk starts (the nose), the travel's direction and the speed: written before `walkLineOf`. */
  x0: number;
  z0: number;
  dx: number;
  dz: number;
  speed: number;
}

export function newLineWalk(most = 64): LineWalk {
  return { n: 0, d: new Float64Array(most), g: new Float64Array(most), x: new Float64Array(most), z: new Float64Array(most), past: Number.NaN, pastD: 0.5, reach: 0.5, got: 0.5, x0: 0.5, z0: 0.5, dx: 0.5, dz: 0.5, speed: 0.5 };
}

/** The ground a reader gives at a point: a built block, else the nearest far lattice point through the ring, else NaN. */
export function groundAhead(reader: LineReader, ring: LatticeRing, x: number, z: number): number {
  const near = reader.near(x, z);
  if (near !== null && Number.isFinite(near)) return near;
  const s = reader.farStep;
  if (!(s > 0)) return Number.NaN;
  return ring.at(reader, Math.round((x - reader.farX()) / s), Math.round((z - reader.farZ()) / s));
}

/**
 * The walk: cached ground every `lookStep` from the nose along the travel, out to `lookAhead × speed` and never past
 * `lookMax`, stopping at the first sample the cache cannot answer, and the one sample past its end. `water` lays the
 * flat water over each. Once a plan; nothing allocated.
 */
export function walkLine(reader: LineReader, ring: LatticeRing, noseX: number, noseZ: number, dirX: number, dirZ: number, speed: number, tune: { lookAhead: number; lookMax: number; lookStep: number }, out: LineWalk, water: ((x: number, z: number) => number) | null = null): LineWalk {
  out.x0 = noseX;
  out.z0 = noseZ;
  out.dx = dirX;
  out.dz = dirZ;
  out.speed = speed;
  return walkLineOf(reader, ring, tune, out, water);
}

/** `walkLine` from the start, direction and speed the walk record carries (`x0`, `z0`, `dx`, `dz`, `speed`). */
export function walkLineOf(reader: LineReader, ring: LatticeRing, tune: { lookAhead: number; lookMax: number; lookStep: number }, out: LineWalk, water: ((x: number, z: number) => number) | null = null): LineWalk {
  const noseX = out.x0;
  const noseZ = out.z0;
  const dirX = out.dx;
  const dirZ = out.dz;
  const step = Math.max(0.5, tune.lookStep);
  const reach = Math.min(tune.lookAhead * Math.max(0, out.speed), tune.lookMax);
  out.n = 0;
  out.reach = reach;
  out.got = 0;
  out.past = Number.NaN;
  out.pastD = 0;
  const most = out.d.length;
  for (let k = 1; out.n < most; k++) {
    const d = k * step;
    const x = noseX + dirX * d;
    const z = noseZ + dirZ * d;
    let g = groundAhead(reader, ring, x, z);
    if (!Number.isFinite(g)) break;
    if (water) {
      const w = water(x, z);
      if (w > g) g = w;
    }
    if (d > reach + 1e-6) {
      out.past = g;
      out.pastD = d;
      break;
    }
    out.d[out.n] = d;
    out.g[out.n] = g;
    out.x[out.n] = x;
    out.z[out.n] = z;
    out.n++;
    out.got = d;
  }
  return out;
}

/**
 * What a step asks of the walk, and what it is told, as one kept record: a number handed to a call the compiler did
 * not build into its caller is a number made, so the drive's every-step questions go through records like this one.
 * The plain functions beside each (`lineFrom`, `underAheadOf`, `lineRateOf`) are the same arithmetic with arguments,
 * for the tests and for anything not stepped.
 */
export interface LineQuery {
  /** `lineFromOf`: the ground under the hull, the distance past which the walk counts, the share, the sample past the end. */
  under: number;
  from: number;
  share: number;
  past: boolean;
  /** `underAheadOfQ`: how far on, and the footprint's length. */
  f: number;
  length: number;
  /** `lineRateOfQ`: the ground under the footprint `f` on, and the speed. */
  underAhead: number;
  speed: number;
  /** The answer. */
  out: number;
}

export function newLineQuery(): LineQuery {
  return { under: 0.5, from: 0.5, share: 0.5, past: false, f: 0.5, length: 0.5, underAhead: 0.5, speed: 0.5, out: 0.5 };
}

const LQ = newLineQuery();

/** The line from the ground under the hull and the walk: raised `share` of the way toward the highest ground ahead past `from`. */
export function lineFrom(under: number, walk: LineWalk, from: number, share: number, withPast = false): number {
  LQ.under = under;
  LQ.from = from;
  LQ.share = share;
  LQ.past = withPast;
  lineFromOf(walk, LQ);
  return LQ.out;
}

/** `lineFrom` through a record: reads `under`, `from`, `share` and `past`, writes `out`. */
export function lineFromOf(walk: LineWalk, q: LineQuery): void {
  const under = q.under;
  const from = q.from;
  let ahead = -Infinity;
  for (let i = 0; i < walk.n; i++) if (walk.d[i] > from && walk.g[i] > ahead) ahead = walk.g[i];
  if (q.past && Number.isFinite(walk.past) && walk.past > ahead) ahead = walk.past;
  q.out = ahead > under ? under + q.share * (ahead - under) : under;
}

/**
 * The ground under the hull a little ahead (`f` metres on): the walk's samples under the footprint then, its two ends
 * read between the samples either side of them (a walk's step is longer than a hull is short, and on a slope the
 * highest ground under the footprint is at an end), and `under` while the footprint still reaches back over itself.
 */
export function underAheadOf(walk: LineWalk, under: number, f: number, length: number): number {
  LQ.under = under;
  LQ.f = f;
  LQ.length = length;
  underAheadOfQ(walk, LQ);
  return LQ.out;
}

/** `underAheadOf` through a record: reads `under`, `f` and `length`, writes `out`. */
export function underAheadOfQ(walk: LineWalk, q: LineQuery): void {
  const f = q.f;
  const length = q.length;
  let u = f < length ? q.under : -Infinity;
  for (let i = 0; i < walk.n; i++) if (walk.d[i] <= f + 1e-9 && walk.d[i] >= f - length && walk.g[i] > u) u = walk.g[i];
  // The footprint's two ends, read between the samples either side (NaN outside the samples, which compares false).
  for (let e = 0; e < 2; e++) {
    const d = e === 0 ? f - length : f;
    for (let i = 0; i + 1 < walk.n; i++) {
      const a = walk.d[i];
      const b = walk.d[i + 1];
      if (d >= a && d <= b) {
        const g = walk.g[i] + ((walk.g[i + 1] - walk.g[i]) * (d - a)) / Math.max(1e-9, b - a);
        if (g > u) u = g;
        break;
      }
    }
  }
  q.out = Number.isFinite(u) ? u : q.under;
}

/** The walk's ground at a distance from the nose, between the two samples either side; NaN outside the samples. */
export function walkAt(walk: LineWalk, d: number): number {
  for (let i = 0; i + 1 < walk.n; i++) {
    const a = walk.d[i];
    const b = walk.d[i + 1];
    if (d >= a && d <= b) return walk.g[i] + ((walk.g[i + 1] - walk.g[i]) * (d - a)) / Math.max(1e-9, b - a);
  }
  return Number.NaN;
}

/**
 * The line's rate (m/s) from the one walk: the line `feedAhead` seconds on, less the line now, over that time. The
 * line ahead uses the same samples less those nearer than speed × feedAhead, plus the one past the walk's end.
 */
export function lineRateOf(walk: LineWalk, under: number, underAhead: number, speed: number, tune: { feedAhead: number; lookShare: number }): number {
  LQ.under = under;
  LQ.underAhead = underAhead;
  LQ.speed = speed;
  lineRateOfQ(walk, LQ, tune);
  return LQ.out;
}

/** `lineRateOf` through a record: reads `under`, `underAhead` and `speed`, writes `out` (and uses `from`, `share` and `past` on its way). */
export function lineRateOfQ(walk: LineWalk, q: LineQuery, tune: { feedAhead: number; lookShare: number }): void {
  const under = q.under;
  const underAhead = q.underAhead;
  const f = Math.max(0, q.speed) * tune.feedAhead;
  q.from = 0;
  q.share = tune.lookShare;
  q.past = false;
  lineFromOf(walk, q);
  const now = q.out;
  q.under = underAhead;
  q.from = f;
  q.past = true;
  lineFromOf(walk, q);
  const later = q.out;
  q.under = under;
  q.out = tune.feedAhead > 0 ? (later - now) / tune.feedAhead : 0;
}

// ------------------------------------------------------------------------------------------------ the bridge

/**
 * The flat closing of a row of samples a lattice step apart, by a window of `nw` samples: for every window that
 * starts at `i`, the highest sample in it (`dil[i]`), or NaN where the window holds a sample the cache could not
 * answer (NaN) or runs past the row. A pit narrower than the window fills to its lower rim (`closedAt`). The deque
 * is a scratch of the caller's; nothing is made.
 */
export function bridgeClose(samples: Float64Array, n: number, nw: number, dil: Float64Array, deque: Int32Array): number {
  const w = Math.max(1, Math.round(nw));
  const starts = n - w + 1;
  if (starts <= 0) return 0;
  let head = 0;
  let tail = 0;
  let lastNaN = -1;
  for (let j = 0; j < n; j++) {
    const v = samples[j];
    if (Number.isNaN(v)) lastNaN = j;
    else {
      while (tail > head && samples[deque[tail - 1]] <= v) tail--;
      deque[tail++] = j;
    }
    const i = j - w + 1;
    if (i < 0) continue;
    while (tail > head && deque[head] < i) head++;
    dil[i] = lastNaN >= i || tail === head ? Number.NaN : samples[deque[head]];
  }
  return starts;
}

/**
 * The closing at sample `j`: the lowest window high over every window holding it. NaN unless every one of those
 * windows is in the row and sees only answered samples: a window that runs off the row or holds a sample the cache
 * could not answer might be the one window that sees the pit's floor, so a pit whose far side is unseen is never
 * filled from its near side alone.
 */
export function closedAt(dil: Float64Array, starts: number, nw: number, j: number): number {
  const w = Math.max(1, Math.round(nw));
  const lo = j - w + 1;
  if (lo < 0 || j > starts - 1) return Number.NaN;
  let best = Infinity;
  for (let i = lo; i <= j; i++) {
    const v = dil[i];
    if (Number.isNaN(v)) return Number.NaN;
    if (v < best) best = v;
  }
  return best === Infinity ? Number.NaN : best;
}

/** The closing at a place between samples (`at` in samples from the row's start), the two neighbours' interpolated; NaN where either cannot be seen. */
export function closedBetween(dil: Float64Array, starts: number, nw: number, at: number): number {
  CQ.at = at;
  closedBetweenOf(dil, starts, nw, CQ);
  return CQ.out;
}
const CQ = { at: 0.5, out: 0.5 };

/** `closedBetween` through a record: reads `at`, writes `out`. */
export function closedBetweenOf(dil: Float64Array, starts: number, nw: number, q: { at: number; out: number }): void {
  const w = Math.max(1, Math.round(nw));
  const i = Math.floor(q.at);
  const f = q.at - i;
  let out = Number.NaN;
  for (let e = 0; e < (f < 1e-9 ? 1 : 2); e++) {
    // The closing at sample j, as `closedAt` works it out, written in here so nothing crosses a call.
    const j = i + e;
    const lo = j - w + 1;
    let c = Number.NaN;
    if (lo >= 0 && j <= starts - 1) {
      let best = Infinity;
      for (let k = lo; k <= j; k++) {
        const v = dil[k];
        if (Number.isNaN(v)) {
          best = Number.NaN;
          break;
        }
        if (v < best) best = v;
      }
      c = best === Infinity ? Number.NaN : best;
    }
    out = e === 0 ? c : out * (1 - f) + c * f;
  }
  q.out = out;
}

/**
 * The closing at a place between samples as the drive's `under` takes it (`closedBetweenOf`), but only where the
 * closing has lifted something: where neither sample either side of the place is raised by it, NaN, and the raw ground
 * answers there to the bit. Interpolated between two samples it leaves as they are, a closing stands over the true
 * ground wherever the ground bends upward between them -- at the foot of every slope, by up to a quarter of the slope
 * over a lattice step (0.29 m on 30 degrees) -- and it lifted the hull over every valley floor it crossed, pits or none.
 * A closing is always one of the samples, so "raised" is a plain comparison. Reads `at`, writes `out`.
 */
export function bridgedBetweenOf(samples: Float64Array, dil: Float64Array, starts: number, nw: number, q: { at: number; out: number }): void {
  const w = Math.max(1, Math.round(nw));
  const i = Math.floor(q.at);
  const f = q.at - i;
  let out = Number.NaN;
  let lifted = false;
  for (let e = 0; e < (f < 1e-9 ? 1 : 2); e++) {
    // The closing at sample j, as `closedAt` works it out, written in here so nothing crosses a call.
    const j = i + e;
    const lo = j - w + 1;
    let c = Number.NaN;
    if (lo >= 0 && j <= starts - 1) {
      let best = Infinity;
      for (let k = lo; k <= j; k++) {
        const v = dil[k];
        if (Number.isNaN(v)) {
          best = Number.NaN;
          break;
        }
        if (v < best) best = v;
      }
      c = best === Infinity ? Number.NaN : best;
    }
    // NaN on either side compares false: nothing unseen counts as lifted.
    if (c > samples[j]) lifted = true;
    out = e === 0 ? c : out * (1 - f) + c * f;
  }
  q.out = lifted ? out : Number.NaN;
}

// ------------------------------------------------------------------------------------------------ height

/** The phases of the height rule, for the console. */
export const RISE = 1;
export const BAND = 2;
export const FALL = 3;

/** How far a fall from `v0` carries in `t` seconds at `fall` m/s², its speed never past `fallMax`: exact, not stepped. */
export function fallDisplacement(v0: number, t: number, fall: number, fallMax: number): number {
  if (!(t > 0)) return 0;
  const v1 = v0 - fall * t;
  if (v1 >= -fallMax) return v0 * t - 0.5 * fall * t * t;
  if (v0 <= -fallMax) return -fallMax * t;
  const tc = (v0 + fallMax) / fall;
  return v0 * tc - 0.5 * fall * tc * tc - fallMax * (t - tc);
}

/** The mean vertical speed of a fall over `n` fixed steps, the command that leaves the body on the parabola at their end. */
export function planFall(vy: number, n: number, fixedDt: number, tune: { fall: number; fallMax: number }): number {
  const t = n * fixedDt;
  return t > 0 ? fallDisplacement(vy, t, tune.fall, tune.fallMax) / t : vy;
}

/** The height rule's state: the hull's lowest point and its vertical speed. */
export interface VerticalState {
  low: number;
  vy: number;
}

/** A sub-step of the height rule as a record: the state, and the line, its rate and the sub-step's seconds it is stepped by. */
export interface VerticalStep extends VerticalState {
  line: number;
  rate: number;
  dt: number;
}

export function newVerticalStep(): VerticalStep {
  return { low: 0.5, vy: 0.5, line: 0.5, rate: 0.5, dt: 0.5 };
}

const VS = newVerticalStep();

/**
 * One sub-step of the height rule, on the hull's lowest point: under `line + ride` it rises at once toward it
 * (`riseRate`, at most `riseMax`, the line's own rate added); within the band over it it settles; above that it
 * falls, the fall worked out exactly. Writes the state, gives back the phase.
 */
export function stepVertical(st: VerticalState, line: number, lineRate: number, dt: number, tune: { ride: number; riseRate: number; riseMax: number; band: number; bandRate: number; fall: number; fallMax: number }): number {
  VS.low = st.low;
  VS.vy = st.vy;
  VS.line = line;
  VS.rate = lineRate;
  VS.dt = dt;
  const phase = stepVerticalOf(VS, tune);
  st.low = VS.low;
  st.vy = VS.vy;
  return phase;
}

/** `stepVertical` through a record: reads its `line`, `rate` and `dt`, steps its `low` and `vy`, gives back the phase. */
export function stepVerticalOf(st: VerticalStep, tune: { ride: number; riseRate: number; riseMax: number; band: number; bandRate: number; fall: number; fallMax: number }): number {
  const lineRate = st.rate;
  const dt = st.dt;
  const want = st.line + tune.ride;
  if (st.low < want) {
    // Under its line the hull is too low already, so the line's fall ahead never takes it further down: it waits for the
    // line to come down to it. With the fall in, a hull reaching a short bridged ledge partway down a descent, where the
    // line holds flat while the line a tenth of a second on has already dropped past the ledge, was driven on down
    // through its own ride at the descent's speed and struck the ledge's far rim (raceGround's false dives).
    const target = Math.min(tune.riseMax, (want - st.low) * tune.riseRate + (lineRate > 0 ? lineRate : 0));
    // A hull already rising faster (a strike's kick) keeps it, easing down toward what the shortfall asks at the rise's
    // own rate. Held at its first speed instead (the plain larger of the two), a rise carried that speed all the way to
    // the line and past it by the band and more: a 10 m lift ahead of a face overshot to 20 m and flew the face.
    st.vy = st.vy > target ? target + (st.vy - target) * Math.exp(-tune.riseRate * dt) : target;
    st.low += st.vy * dt;
    return RISE;
  }
  if (st.low - want <= tune.band) {
    const target = (want - st.low) * tune.bandRate + lineRate;
    st.vy += (target - st.vy) * (1 - Math.exp(-tune.bandRate * dt));
    st.low += st.vy * dt;
    return BAND;
  }
  const v0 = st.vy;
  // The fall over the sub-step, worked out exactly (`fallDisplacement`, written in so nothing crosses a call).
  const fall = tune.fall;
  const fallMax = tune.fallMax;
  let drop = 0;
  if (dt > 0) {
    if (v0 - fall * dt >= -fallMax) drop = v0 * dt - 0.5 * fall * dt * dt;
    else if (v0 <= -fallMax) drop = -fallMax * dt;
    else {
      const tc = (v0 + fallMax) / fall;
      drop = v0 * tc - 0.5 * fall * tc * tc - fallMax * (dt - tc);
    }
  }
  st.low += drop;
  st.vy = Math.max(-fallMax, Math.min(v0, v0 - fall * dt));
  return FALL;
}

/**
 * The crossed points of one piece of travel, as the strike sweep reads them: the ground under the footprint at each
 * (`g`), the ground `faceLen` behind it (`back`), and the hull's lowest point there, interpolated (`y`).
 */
export interface SweptPath {
  n: number;
  g: Float64Array;
  back: Float64Array;
  y: Float64Array;
}

export function newSweptPath(most = 16): SweptPath {
  return { n: 0, g: new Float64Array(most), back: new Float64Array(most), y: new Float64Array(most) };
}

/**
 * A strike's kick: the steepest grade over `faceLen` of the part of the ground standing above the hull's lowest
 * point, among the points crossed, times the horizontal speed, never more than `riseMax`. A 0.3 m clip of a 10 m
 * wall kicks no harder than a 0.3 m step.
 */
export function strikeKick(path: SweptPath, speed: number, tune: { faceLen: number; riseMax: number }): number {
  // Signed: on a descent the ground's own rise is below nought, and a hull clipping a falling slope follows it down
  // rather than reading the slope's whole fall as the speed it struck at.
  let steepest = -Infinity;
  for (let i = 0; i < path.n; i++) {
    if (!(path.g[i] > path.y[i])) continue;
    const grade = (path.g[i] - Math.max(path.back[i], path.y[i])) / tune.faceLen;
    if (grade > steepest) steepest = grade;
  }
  if (steepest === -Infinity) return 0;
  return Math.min(tune.riseMax, Math.abs(speed) * steepest);
}

/**
 * The steepest face met: the grade over `faceLen` at each crossed point where the ground stands more than `lipMost`
 * over the hull's lowest point there. A face steeper than `climbGrade` is a wall; a lip under `lipMost` is a strike.
 * −Infinity where nothing stands that high.
 */
export function faceVerdict(path: SweptPath, lipMost: number, tune: { faceLen: number }): number {
  let face = -Infinity;
  for (let i = 0; i < path.n; i++) {
    if (!(path.g[i] - path.y[i] > lipMost)) continue;
    const grade = (path.g[i] - path.back[i]) / tune.faceLen;
    if (grade > face) face = grade;
  }
  return face;
}

/** The speed allowed to rise over ground standing `need` metres over the hull's lowest point `d` metres ahead in time: Infinity when it can. */
export function climbAllowed(need: number, d: number, riseMax: number): number {
  if (!(need > 0) || !(d > 0)) return Infinity;
  return (riseMax * d) / need;
}

/** What one judging pass of the ground ahead found: how far it judged, the worst cut and where. */
export interface ClimbJudged {
  to: number;
  allowed: number;
  points: number;
}

/**
 * A judging pass as a record (`climbVerdictOf`): from the mark `from`, the nose `nose` on the odometer, the plan's
 * `travel`, the hull's lowest point `low` and the lattice's `step`; the ground is read by handing the reader the record
 * with `at` set, which writes `g` and says whether the cache answered.
 */
export interface ClimbPass extends ClimbJudged {
  from: number;
  nose: number;
  travel: number;
  low: number;
  step: number;
  at: number;
  g: number;
}

export function newClimbPass(): ClimbPass {
  return { to: 0.5, allowed: Infinity, points: 0, from: 0.5, nose: 0.5, travel: 0.5, low: 0.5, step: 0.5, at: 0.5, g: 0.5 };
}

const CP = newClimbPass();
let cpGround: ((at: number) => number | null) | null = null;
const cpRead = (q: ClimbPass): boolean => {
  const g = cpGround ? cpGround(q.at) : null;
  if (g === null || !Number.isFinite(g)) return false;
  q.g = g;
  return true;
};

/**
 * The rise too tall to clear in time: every ground point from the mark `from` to `nose + travel + climbLen`, a
 * `step` apart on a lattice fixed to the distance travelled, judged once each: at distance `d` from the nose, with
 * `need` its height over the hull's lowest point now, a speed over `riseMax·d/need` cannot lift over it in time.
 * `ground(at)` reads the ground at a distance travelled (null: the cache cannot answer, and nothing is judged
 * there). Nothing ever judges a point ahead by its grade from the ground under the nose.
 */
export function climbVerdict(ground: (at: number) => number | null, from: number, nose: number, travel: number, low: number, tune: { climbLen: number; riseMax: number }, step: number, out: ClimbJudged): ClimbJudged {
  CP.from = from;
  CP.nose = nose;
  CP.travel = travel;
  CP.low = low;
  CP.step = step;
  cpGround = ground;
  try {
    climbVerdictOf(cpRead, tune, CP);
  } finally {
    cpGround = null;
  }
  out.to = CP.to;
  out.allowed = CP.allowed;
  out.points = CP.points;
  return out;
}

/** `climbVerdict` through a record (`ClimbPass`), its ground read by handing the reader the record. */
export function climbVerdictOf(ground: (q: ClimbPass) => boolean, tune: { climbLen: number; riseMax: number }, out: ClimbPass): void {
  out.allowed = Infinity;
  out.points = 0;
  const nose = out.nose;
  const low = out.low;
  const step = out.step;
  const riseMax = tune.riseMax;
  const to = nose + out.travel + tune.climbLen;
  let p = out.from;
  for (let k = 0; k < 4096; k++) {
    const next = p + step;
    if (next > to + 1e-9) break;
    p = next;
    out.points++;
    out.at = p;
    if (!ground(out)) continue;
    // `climbAllowed`, written in.
    const need = out.g - low;
    const d = p - nose;
    if (need > 0 && d > 0) {
      const allowed = (riseMax * d) / need;
      if (allowed < out.allowed) out.allowed = allowed;
    }
  }
  out.to = p;
}

// ------------------------------------------------------------------------------------------------ slopes and pose

/**
 * The slope's push a step asks for: downhill along the travel `slopeDown·sin²θ` of the speed, uphill `slopeUp·sin²θ`
 * of it taken away, nothing under `slopeFloor` and nothing in the air. `theta` is the slope along the travel,
 * negative descending (radians); `speed` the curve's.
 */
export function slopePush(theta: number, speed: number, airborne: boolean, tune: { slopeDown: number; slopeUp: number; slopeFloor: number }): number {
  if (airborne) return 0;
  const a = Math.abs(theta);
  if (a < (tune.slopeFloor * Math.PI) / 180) return 0;
  const s = Math.sin(a);
  const s2 = s * s;
  return theta < 0 ? tune.slopeDown * s2 * speed : -tune.slopeUp * s2 * speed;
}

/** `lowestOffset` of a hull's own bounds (either corner first) at the pose a record carries (`ex`, `ez`), into its `low`. */
export function lowestOffsetOf(b: { readonly min: readonly number[]; readonly max: readonly number[] }, pose: { ex: number; ez: number; low: number }): void {
  const minX = b.min[0] < b.max[0] ? b.min[0] : b.max[0];
  const maxX = b.min[0] < b.max[0] ? b.max[0] : b.min[0];
  const y0 = b.min[1] < b.max[1] ? b.min[1] : b.max[1];
  const minZ = b.min[2] < b.max[2] ? b.min[2] : b.max[2];
  const maxZ = b.min[2] < b.max[2] ? b.max[2] : b.min[2];
  const cx = Math.cos(pose.ex);
  const sx = Math.sin(pose.ex);
  const cz = Math.cos(pose.ez);
  const sz = Math.sin(pose.ez);
  let low = Infinity;
  for (let i = 0; i < 4; i++) {
    const x = i & 1 ? maxX : minX;
    const z = i & 2 ? maxZ : minZ;
    const y = (x * sz + y0 * cz) * cx - z * sx;
    if (y < low) low = y;
  }
  pose.low = low;
}

/**
 * How far the posed hull's lowest point stands under its origin: the four corners of its underside, turned by the
 * pitch (Euler x, radians) and the roll (Euler z) in the YXZ order the body is written in. The heading never moves it.
 */
export function lowestOffset(minX: number, maxX: number, y0: number, minZ: number, maxZ: number, ex: number, ez: number): number {
  const cx = Math.cos(ex);
  const sx = Math.sin(ex);
  const cz = Math.cos(ez);
  const sz = Math.sin(ez);
  let low = Infinity;
  for (let i = 0; i < 4; i++) {
    const x = i & 1 ? maxX : minX;
    const z = i & 2 ? maxZ : minZ;
    const y = (x * sz + y0 * cz) * cx - z * sx;
    if (y < low) low = y;
  }
  return low;
}
