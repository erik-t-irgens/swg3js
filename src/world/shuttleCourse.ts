// A shuttle flown between two pads: the course it is planned along, and the pilot that flies it.
//
// Where a shuttle climbs out and where it comes in are fixed by the turn of each pad and have nothing
// to do with where it is going: over every pair of pads on the converted worlds the bend is about a
// right angle at either end, and two pads can stand 77 m apart. So a trip is never flown straight at
// its landing. It is planned once, as the take-off lets go of the hull: straight on the way it climbed
// out for a little, then the shortest two turns and a straight between them (a Dubins path, at the
// radius this pilot really turns at) to a gate on the landing's own line, and down that line to where
// the landing clip takes the hull back. The pilot chases a point a couple of seconds ahead on that
// course, wings level, with its stick capped and slowed by a hand as every NPC pilot's is
// (`skillStick`), and never rolls a passenger over to pull a turn (`steerToward`'s level branch only).
//
// How high it flies is a law along the course rather than a reaction: over whatever ground lies within
// `look` ahead by `clear` (coming down to the join's own height over its pad by the end), but no higher
// than a climb of `climbMax` out of the take-off or a glide back from the join allows, and never below a
// floor under the hull; past the end of the course it holds the join's height. The ground is read only where
// the world already holds it (`groundCached`) and a few samples a step, since asking for ground that is
// not there makes it on the spot and a far grid's key is a string; ground not yet known reads as the
// highest this course has seen, so the law never drops for want of an answer. Anything solid seen
// ahead, and another ship too near or on a course to meet it, only raise the height it wants for a
// moment: it goes over rather than round, and never leaves its course.
//
// It says when it has come abeam the landing's join, and whether it is close enough there to hand over;
// a pass too far off asks, once, to be planned again from where it is (a go-around).
//
// Pure: it imports the NPC pilot's own arithmetic (`src/space/pilot.ts`) and nothing else, so node runs
// it (`shuttleCourse.test.ts`). A plan allocates its course once; a step allocates nothing. Every
// number is ours, in `RIDE_PILOT`, live through `__debug.ride({ pilot })`.

import { AVOID_TUNE, PILOT_SKILL, STICK_GAIN, pushApart, skillStick, steerToward, toLocal, toWorld, type PilotSkill, type Q4, type Stick, type V3 } from '../space/pilot.ts';

/** Every number of the shuttles' pilot, all ours; measured over every pair of rigged pads (`shuttleCourse.test.ts`). */
export const RIDE_PILOT = {
  /** Metres a second between the pads, where the hull can go that fast. */
  cruise: 150,
  /** The most of the stick the hand ever uses, and the seconds it takes to move it end to end: gentle turns, no jerks. */
  stickMax: 0.6,
  response: 0.6,
  /**
   * Seconds ahead the hand reads how far off the point chased the nose is: the stick answers the error
   * as it will stand this long from now at the rate it is closing, not only as it stands (a derivative
   * on the error, so a steady turn or climb along the course is not leaned against, only a swing about
   * it). The rig hull takes 1.2 s to come round to what its stick asks, and chasing a point two seconds
   * ahead through that lag on the error alone swayed the hull about its line and its height every four
   * seconds and shed a tenth of each swing: the stick changed sides every two seconds all the way down
   * the final approach, and a drop in the height law was dived past by tens of metres before it came back
   * up (worked out as a third-order loop and measured, `shuttleCourse.test.ts`). At 0.75 s the loop sheds
   * more than half of a swing each time round; 0 puts the old hand back.
   */
  errorLead: 0.75,
  /** The planned turns are this much wider than the hull can fly, which is its room to correct. */
  planMargin: 1.35,
  /** Metres between the course's samples. */
  step: 20,
  /** Metres flown straight on out of the take-off before the first turn, and the landing's own line flown in to its join. */
  departStraight: 250,
  finalLen: 800,
  /** The point chased is this many seconds of flight ahead on the course, and at least this many metres. */
  carrotSeconds: 2,
  carrotMin: 60,
  /** Degrees: the steepest climb and dive it flies, and the least glide it comes in on. */
  climbMax: 25,
  descentMax: 32,
  glideMin: 6,
  /**
   * Degrees: the steepest it climbs while it is under its own floor (the ground ahead rising faster
   * than `climbMax` climbs). The ground out of Lake Retreat rises at thirty degrees for half a kilometre;
   * held to `climbMax` a hull that no longer sways past what it asks for cleared it by two metres, where
   * the swaying one had cleared it by twenty-eight only by overshooting to thirty degrees.
   */
  climbSteep: 35,
  /** Metres: how far ahead the ground is looked over, and how high over it the course is held. */
  look: 2000,
  clear: 150,
  /**
   * The floor under the hull: never nearer the ground than `floor` over the ground from itself to
   * `floorAhead` beyond the point chased, eased down to `padClear` near either pad -- from `padNear`
   * metres of the course's ends, over `padBlend` -- since the clips take off and come in low.
   */
  floor: 60,
  padClear: 10,
  padNear: 200,
  padBlend: 800,
  floorAhead: 100,
  /** Metres of course left over which it slows from cruise to the landing's own speed, ending this far out. */
  slowSpan: 700,
  slowEnd: 100,
  /** Radians off the nose past which a turn would roll it over and pull: never, with a passenger aboard. */
  bankBeyond: Math.PI,
  /** Metres over something seen ahead, or over another ship in the way, it climbs to for a moment. */
  overClear: 40,
  /** Ground samples read a step at the most. */
  groundPerFrame: 8,
  /** How far off the join (metres across its line and up, degrees of heading) is close enough to hand over. */
  joinTol: { across: 20, up: 20, heading: 12 },
  /** How many times a pass too far off is flown again. */
  goArounds: 1,
};

/** The pilot's hand, a tier-one NPC's with the stick and the speed of it the ride's own. */
export const RIDE_SKILL: PilotSkill = { ...PILOT_SKILL[1], stickMax: RIDE_PILOT.stickMax, response: RIDE_PILOT.response };

/** What the pilot writes for the flight model to read (a `DriveInput`), kept and written in place. */
export interface PilotDrive {
  throttle: number;
  steer: number;
  heading: null;
  boost: boolean;
  hop: boolean;
  up: boolean;
  down: boolean;
  stickX: number;
  stickY: number;
  cruise: number;
}

// ---------------------------------------------------------------- the plane's shortest paths

/** A Dubins path: its word (L, S and R for left, straight and right), each piece's length over the radius, and its whole length in metres. */
export interface DubinsPath {
  word: string;
  seg: [number, number, number];
  length: number;
}

const TWO_PI = Math.PI * 2;
const mod2pi = (a: number): number => ((a % TWO_PI) + TWO_PI) % TWO_PI;
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Every word that joins the two poses (Shkel and Lumelsky's forms), distances over the radius. Build-time. */
function dubinsWords(alpha: number, beta: number, d: number): { w: string; t: number; p: number; q: number }[] {
  const sa = Math.sin(alpha);
  const sb = Math.sin(beta);
  const ca = Math.cos(alpha);
  const cb = Math.cos(beta);
  const cab = Math.cos(alpha - beta);
  const out: { w: string; t: number; p: number; q: number }[] = [];
  {
    const p2 = 2 + d * d - 2 * cab + 2 * d * (sa - sb);
    if (p2 >= 0) {
      const tmp = Math.atan2(cb - ca, d + sa - sb);
      out.push({ w: 'LSL', t: mod2pi(-alpha + tmp), p: Math.sqrt(p2), q: mod2pi(beta - tmp) });
    }
  }
  {
    const p2 = 2 + d * d - 2 * cab + 2 * d * (sb - sa);
    if (p2 >= 0) {
      const tmp = Math.atan2(ca - cb, d - sa + sb);
      out.push({ w: 'RSR', t: mod2pi(alpha - tmp), p: Math.sqrt(p2), q: mod2pi(-beta + tmp) });
    }
  }
  {
    const p2 = -2 + d * d + 2 * cab + 2 * d * (sa + sb);
    if (p2 >= 0) {
      const p = Math.sqrt(p2);
      const tmp = Math.atan2(-ca - cb, d + sa + sb) - Math.atan2(-2, p);
      out.push({ w: 'LSR', t: mod2pi(-alpha + tmp), p, q: mod2pi(-mod2pi(beta) + tmp) });
    }
  }
  {
    const p2 = d * d - 2 + 2 * cab - 2 * d * (sa + sb);
    if (p2 >= 0) {
      const p = Math.sqrt(p2);
      const tmp = Math.atan2(ca + cb, d - sa - sb) - Math.atan2(2, p);
      out.push({ w: 'RSL', t: mod2pi(alpha - tmp), p, q: mod2pi(beta - tmp) });
    }
  }
  {
    const tmp = (6 - d * d + 2 * cab + 2 * d * (sa - sb)) / 8;
    if (Math.abs(tmp) <= 1) {
      const p = mod2pi(TWO_PI - Math.acos(tmp));
      const t = mod2pi(alpha - Math.atan2(ca - cb, d - sa + sb) + p / 2);
      out.push({ w: 'RLR', t, p, q: mod2pi(alpha - beta - t + p) });
    }
  }
  {
    const tmp = (6 - d * d + 2 * cab + 2 * d * (sb - sa)) / 8;
    if (Math.abs(tmp) <= 1) {
      const p = mod2pi(TWO_PI - Math.acos(tmp));
      const t = mod2pi(-alpha - Math.atan2(ca - cb, d + sa - sb) + p / 2);
      out.push({ w: 'LRL', t, p, q: mod2pi(mod2pi(beta) - alpha - t + p) });
    }
  }
  return out;
}

/**
 * The shortest path of turns of radius `R` and straights from (x0, z0) heading `h0` to (x1, z1) heading
 * `h1`, headings as a hull's are (`atan2(dx, dz)`), over all six words: two turns with a straight
 * between, or three turns where the two ends are close. Null only for a pose that is not a number.
 * Build-time: it makes its candidates.
 */
export function dubins(x0: number, z0: number, h0: number, x1: number, z1: number, h1: number, R: number): DubinsPath | null {
  // The plane's x is the world's z and its y the world's x, so an angle from x toward y is a heading.
  const du = z1 - z0;
  const dv = x1 - x0;
  const d = Math.hypot(du, dv) / R;
  const theta = mod2pi(Math.atan2(dv, du));
  const alpha = mod2pi(h0 - theta);
  const beta = mod2pi(h1 - theta);
  let best: { w: string; t: number; p: number; q: number } | null = null;
  let bestL = Infinity;
  for (const c of dubinsWords(alpha, beta, d)) {
    const L = c.t + c.p + c.q;
    if (L < bestL) {
      bestL = L;
      best = c;
    }
  }
  return best ? { word: best.w, seg: [best.t, best.p, best.q], length: bestL * R } : null;
}

/** How many samples a Dubins path is walked in at `step` metres, its start included. */
function dubinsSamples(path: DubinsPath, R: number, step: number): number {
  let n = 1;
  for (let k = 0; k < 3; k++) n += Math.max(1, Math.ceil((path.seg[k] * R) / step));
  return n;
}

/** Walk a Dubins path from its start into the arrays at `at`, each turn stepped along its own arc exactly; the next free index comes back. */
function fillDubins(x0: number, z0: number, h0: number, path: DubinsPath, R: number, step: number, xs: Float64Array, zs: Float64Array, hs: Float64Array, at: number): number {
  let u = z0;
  let v = x0;
  let th = h0;
  xs[at] = v;
  zs[at] = u;
  hs[at] = th;
  at++;
  for (let k = 0; k < 3; k++) {
    const len = path.seg[k] * R;
    const n = Math.max(1, Math.ceil(len / step));
    const ds = len / n;
    const kind = path.word[k];
    for (let i = 0; i < n; i++) {
      if (kind === 'S') {
        u += Math.cos(th) * ds;
        v += Math.sin(th) * ds;
      } else {
        // L: the heading grows (toward +x); R: it falls.
        const sgn = kind === 'L' ? 1 : -1;
        const dth = (sgn * ds) / R;
        u += R * sgn * (Math.sin(th + dth) - Math.sin(th));
        v += R * sgn * (-Math.cos(th + dth) + Math.cos(th));
        th += dth;
      }
      xs[at] = v;
      zs[at] = u;
      hs[at] = th;
      at++;
    }
  }
  return at;
}

/** The radius a pilot plans its turns at: `speed` over the rate its capped stick turns the hull at, with room to spare. */
export function planRadius(speed: number, turnRate: number, tune = RIDE_PILOT): number {
  const omega = Math.max(1e-3, turnRate * 1.5 * tune.stickMax);
  return (Math.max(1, speed) / omega) * tune.planMargin;
}

// ---------------------------------------------------------------- the course

/**
 * Where a course starts or ends: a place, the heading along the ground, the speed, how steeply it is
 * coming down there (radians, for the join) and the height of the ground under it where it is known
 * (the pad's own, for either end).
 */
export interface RideState {
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  descent?: number;
  ground?: number;
}

/**
 * A course, sampled every `step` metres: each sample's place over the ground, its heading and how far
 * along the course it is, and the ground under it as far as it has been read (NaN until then). The
 * final straight starts at `finalFrom`; `join` is where it ends, `cutY` how high it began, `seedGround`
 * what unknown ground reads as before any is known, and `word` the turns it makes.
 */
export interface RideCourse {
  xs: Float64Array;
  zs: Float64Array;
  hs: Float64Array;
  ss: Float64Array;
  ground: Float32Array;
  n: number;
  total: number;
  finalFrom: number;
  join: RideState;
  cutY: number;
  seedGround: number;
  word: string;
  radius: number;
  step: number;
}

/**
 * Plan a course from where a take-off let the hull go to where a landing takes it back: `departStraight`
 * on along the way it was heading, the shortest turns at `radius` to a gate `finalLen` short of the join
 * on the join's own heading, and that straight in. Allocates the course, once per plan.
 */
export function planCourse(from: RideState, join: RideState, radius: number, tune = RIDE_PILOT): RideCourse {
  const hC = from.heading;
  const hJ = join.heading;
  const dep = Math.max(0, tune.departStraight);
  const fin = Math.max(0, tune.finalLen);
  const step = Math.max(1, tune.step);
  const R = Math.max(1, radius);
  const d0x = from.x + Math.sin(hC) * dep;
  const d0z = from.z + Math.cos(hC) * dep;
  const gx = join.x - Math.sin(hJ) * fin;
  const gz = join.z - Math.cos(hJ) * fin;
  // Two poses that are not numbers have no path: a straight line stands in, so a course always exists.
  const path: DubinsPath = dubins(d0x, d0z, hC, gx, gz, hJ, R) ?? { word: 'SSS', seg: [0, Math.hypot(gx - d0x, gz - d0z) / R || 0, 0], length: Math.hypot(gx - d0x, gz - d0z) || 0 };
  const n0 = dep > 0 ? Math.ceil(dep / step) : 0;
  const nf = fin > 0 ? Math.ceil(fin / step) : 0;
  const n = n0 + dubinsSamples(path, R, step) + nf;
  const xs = new Float64Array(n);
  const zs = new Float64Array(n);
  const hs = new Float64Array(n);
  const ss = new Float64Array(n);
  const ground = new Float32Array(n).fill(Number.NaN);
  for (let i = 0; i < n0; i++) {
    const s = (i * dep) / n0;
    xs[i] = from.x + Math.sin(hC) * s;
    zs[i] = from.z + Math.cos(hC) * s;
    hs[i] = hC;
  }
  let at = fillDubins(d0x, d0z, hC, path, R, step, xs, zs, hs, n0);
  for (let i = 1; i <= nf; i++) {
    const s = (i * fin) / nf;
    xs[at] = gx + Math.sin(hJ) * s;
    zs[at] = gz + Math.cos(hJ) * s;
    hs[at] = hJ;
    at++;
  }
  for (let i = 1; i < n; i++) ss[i] = ss[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
  const known = Math.max(from.ground ?? -Infinity, join.ground ?? -Infinity);
  return {
    xs,
    zs,
    hs,
    ss,
    ground,
    n,
    total: ss[n - 1],
    finalFrom: n - 1 - nf,
    join: { x: join.x, y: join.y, z: join.z, heading: hJ, speed: join.speed, descent: join.descent ?? 0, ground: join.ground },
    cutY: from.y,
    seedGround: Number.isFinite(known) ? known : Math.min(from.y, join.y) - tune.floor,
    word: path.word,
    radius: R,
    step,
  };
}

// ---------------------------------------------------------------- the pilot

/** Scratch for a step, which makes nothing: one pilot steps at a time. */
const wantDir: V3 = { x: 0, y: 0, z: 1 };
const wantLocal: V3 = { x: 0, y: 0, z: 1 };
const upLocal: V3 = { x: 0, y: 1, z: 0 };
const UP: V3 = { x: 0, y: 1, z: 0 };
const noseDir: V3 = { x: 0, y: 0, z: 1 };
const NOSE: V3 = { x: 0, y: 0, z: 1 };
const dodgeWant: V3 = { x: 0, y: 0, z: 1 };
const deg = (d: number): number => (d * Math.PI) / 180;

/**
 * The hand that flies a course. It is made once for a trip and given a course when the take-off lets
 * go (`setCourse`), and again for a go-around; each step it reads where the hull is and how it is
 * turned, and writes the stick, the roll and the wanted speed into its `drive`, which is the hull's
 * autopilot drive for the whole trip.
 */
export class ShuttlePilot {
  /** What the flight model reads: kept and written in place, never replaced. */
  readonly drive: PilotDrive = { throttle: 0, steer: 0, heading: null, boost: false, hop: false, up: false, down: false, stickX: 0, stickY: 0, cruise: 0 };
  course: RideCourse | null = null;
  /** The sample the hull is nearest along its course. */
  progress = 0;
  /** How many passes have been flown again. */
  goArounds = 0;
  /** The speed it flies between the pads, set with each course. */
  top = RIDE_PILOT.cruise;
  /** How far off the join the last pass abeam it was: metres across its line and up, degrees of heading, metres a second of speed. */
  readonly joinError = { across: 0, up: 0, heading: 0, speed: 0 };
  /** The height it last wanted to be at, and the one something in the way has it climb to until `avoidUntil`. */
  target = 0;
  private avoidY = -Infinity;
  private avoidUntil = -Infinity;
  /** Its clock, as the last step or note had it. */
  private now = 0;
  /** The highest ground this course has read, which is what ground not yet read counts as. */
  private highest = -Infinity;
  private readonly stick: Stick = { x: 0, y: 0, roll: 0 };
  private readonly held: Stick = { x: 0, y: 0, roll: 0 };
  /** The hand's skill, refreshed from `RIDE_PILOT` each step so a change there is taken at once. */
  private readonly skill: PilotSkill = { ...RIDE_SKILL };
  /** The carrot's place, for the report. */
  private readonly carrot: V3 = { x: 0, y: 0, z: 0 };
  /**
   * How far off the point chased the nose was at the last step, across (yaw) and up (pitch), radians,
   * which is what the rate it is closing at is read off (`errorLead`); `errKnown` false until a step of
   * this course has measured one, since the point chased jumps to another course with a go-around.
   */
  private errYaw = 0;
  private errPitch = 0;
  private errKnown = false;
  /** The floor the height law last held the point chased over (the ground from the hull on, and its clearance): under it, it may climb at `climbSteep`. */
  private floorLine = -Infinity;

  /** A course to fly from here, at `top` metres a second: the stick as the hand holds it now is kept, so a go-around does not jerk it. */
  setCourse(course: RideCourse, top: number): void {
    this.course = course;
    this.progress = 0;
    this.top = top;
    this.highest = course.seedGround;
    this.errKnown = false;
    this.floorLine = -Infinity;
  }

  /** Something solid ahead with its near face at `hitY`: climb over it for a moment. */
  noteObstacle(hitY: number, now: number): void {
    this.now = now;
    this.climbOver(hitY + RIDE_PILOT.overClear);
  }

  /**
   * Another ship at `pos` moving at `vel` with a radius of `r`, against this hull's own: too near, or
   * on a course to meet it (`pushApart`, the NPC pilots' own rule), and the pilot climbs over it for a
   * moment. Only ever up: it never leaves its course.
   */
  noteShip(pos: V3, vel: V3, r: number, selfPos: V3, selfVel: V3, selfR: number): void {
    dodgeWant.x = 0;
    dodgeWant.y = 0;
    dodgeWant.z = 1;
    if (!pushApart(selfPos, selfVel, selfR, pos, vel, r, dodgeWant)) return;
    this.climbOver(pos.y + r + selfR + RIDE_PILOT.overClear);
  }

  private climbOver(y: number): void {
    this.avoidY = this.now < this.avoidUntil ? Math.max(this.avoidY, y) : y;
    this.avoidUntil = this.now + AVOID_TUNE.avoidSeconds;
  }

  /**
   * One step of flight: where the hull is along its course, the ground ahead read a little further,
   * and the stick and speed that fly it at the point chased. 'join' once it has come abeam the join on
   * the final straight close enough to hand over; 'replan' once, for a pass too far off, which the
   * caller answers by planning again from where the hull is. Allocates nothing.
   */
  step(dt: number, now: number, pos: V3, q: Q4, cruise: number, groundCached: (x: number, z: number) => number | null): 'fly' | 'join' | 'replan' {
    const c = this.course;
    if (!c) return 'fly';
    const tune = RIDE_PILOT;
    this.now = now;
    const n = c.n;
    const xs = c.xs;
    const zs = c.zs;
    // Where along it: the nearest sample in a window just behind to well ahead of the last.
    let best = this.progress;
    let bestD = Infinity;
    const to = Math.min(n, this.progress + 40);
    for (let i = Math.max(0, this.progress - 2); i < to; i++) {
      const dx = xs[i] - pos.x;
      const dz = zs[i] - pos.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    this.progress = best;
    const sHere = c.ss[best];
    this.readGround(c, best, groundCached);
    // Abeam the join on the final straight: close enough to hand over, or round once more.
    const j = c.join;
    const sJ = Math.sin(j.heading);
    const cJ = Math.cos(j.heading);
    const rx = pos.x - j.x;
    const rz = pos.z - j.z;
    if (best >= c.finalFrom && rx * sJ + rz * cJ >= 0) {
      toWorld(q, NOSE, noseDir);
      const e = this.joinError;
      e.across = rx * cJ - rz * sJ;
      e.up = pos.y - j.y;
      e.heading = Math.abs(wrap(Math.atan2(noseDir.x, noseDir.z) - j.heading)) * (180 / Math.PI);
      e.speed = cruise - j.speed;
      const within = Math.abs(e.across) <= tune.joinTol.across && Math.abs(e.up) <= tune.joinTol.up && e.heading <= tune.joinTol.heading;
      if (!within && this.goArounds < tune.goArounds) {
        this.goArounds++;
        return 'replan';
      }
      return 'join';
    }
    // The point chased, a couple of seconds on, at the height the law has for it; past the course's end,
    // on down the join's line at the join's own height. Chased down the clip's own glide there instead,
    // a hull coming in level at the join's height dived after it and met the join twenty metres low.
    const descent = j.descent ?? 0;
    const lead = Math.max(tune.carrotMin, cruise * tune.carrotSeconds);
    const s = sHere + lead;
    const cr = this.carrot;
    if (s >= c.total) {
      const e = s - c.total;
      cr.x = j.x + sJ * e;
      cr.z = j.z + cJ * e;
      cr.y = j.y;
      this.target = cr.y;
      this.floorLine = -Infinity;
    } else {
      const i = indexAt(c, s, best);
      const span = c.ss[i + 1] - c.ss[i];
      const k = span > 1e-9 ? (s - c.ss[i]) / span : 0;
      cr.x = xs[i] + (xs[i + 1] - xs[i]) * k;
      cr.z = zs[i] + (zs[i + 1] - zs[i]) * k;
      cr.y = this.heightAt(c, s, i, best, descent);
    }
    const wx = cr.x - pos.x;
    const wy = cr.y - pos.y;
    const wz = cr.z - pos.z;
    const wh = Math.atan2(wx, wz);
    const low = -Math.max(descent + deg(5), deg(tune.descentMax));
    const high = deg(pos.y < this.floorLine ? Math.max(tune.climbMax, tune.climbSteep) : tune.climbMax);
    const gamma = Math.max(low, Math.min(high, Math.atan2(wy, Math.hypot(wx, wz))));
    wantDir.x = Math.sin(wh) * Math.cos(gamma);
    wantDir.y = Math.sin(gamma);
    wantDir.z = Math.cos(wh) * Math.cos(gamma);
    toLocal(q, wantDir, wantLocal);
    toLocal(q, UP, upLocal);
    steerToward(wantLocal, tune.bankBeyond, upLocal, this.stick);
    // The error as it will stand `errorLead` from now at the rate it is closing, in steerToward's own
    // gains, so the chase settles rather than swaying about its line through the hull's own lag. The
    // same two angles steerToward steers by; a point chased that jumps (a go-around, a drop in the height
    // law) moves the stick for one step by no more than a whole stick, which the hand's own pace spreads.
    const ey = Math.atan2(-wantLocal.x, wantLocal.z);
    const ep = Math.atan2(-wantLocal.y, Math.hypot(wantLocal.x, wantLocal.z));
    if (this.errKnown && dt > 1e-6 && tune.errorLead > 0) {
      const k = tune.errorLead / dt;
      this.stick.x += Math.max(-1, Math.min(1, STICK_GAIN.yaw * k * wrap(ey - this.errYaw)));
      this.stick.y += Math.max(-1, Math.min(1, STICK_GAIN.pitch * k * (ep - this.errPitch)));
    }
    this.errYaw = ey;
    this.errPitch = ep;
    this.errKnown = true;
    const skill = this.skill;
    skill.stickMax = tune.stickMax;
    skill.response = tune.response;
    skillStick(this.stick, skill, dt, this.held, now < this.avoidUntil);
    // Slowing into the landing's own speed over the last of the course.
    const left = c.total - sHere;
    const top = this.top;
    const want = Math.min(top, j.speed + (top - j.speed) * Math.max(0, Math.min(1, (left - tune.slowEnd) / Math.max(1, tune.slowSpan))));
    const d = this.drive;
    d.stickX = this.held.x;
    d.stickY = this.held.y;
    d.steer = this.held.roll;
    d.cruise = want;
    d.throttle = cruise < want - 1 ? 1 : 0;
    return 'fly';
  }

  /** The ground under up to `groundPerFrame` samples not read yet, from the hull's own on over the look ahead, where the world already holds it. */
  private readGround(c: RideCourse, from: number, groundCached: (x: number, z: number) => number | null): void {
    const end = Math.min(c.n, from + Math.ceil(RIDE_PILOT.look / c.step) + 1);
    let asked = 0;
    for (let i = from; i < end && asked < RIDE_PILOT.groundPerFrame; i++) {
      if (c.ground[i] === c.ground[i]) continue;
      asked++;
      const g = groundCached(c.xs[i], c.zs[i]);
      if (g === null || !Number.isFinite(g)) continue;
      c.ground[i] = g;
      if (g > this.highest) this.highest = g;
    }
  }

  /**
   * How high to be at `s` along the course (sample `i`), with the hull at sample `iHull`: no higher than
   * the climb out and the glide in allow and no higher than the ground ahead needs, but never below the
   * floor from the hull on, nor below whatever it is climbing over just now.
   *
   * What the ground ahead needs comes down, over the last of the course, from `clear` to the join's own
   * height over its pad (and never below the join itself), the way the floor's clearance comes down near
   * the pads: the landing's join stands lower over its pad than `clear` (the calm transport's 127 m, the
   * shuttle's 56 m), and held at `clear` to the end a hull flew level over the join's height until the
   * glide came down to meet it a few tens of metres out, then dived after it and arrived twenty metres
   * low on every transport route; coming in over ground lower than the pad, it came in that much low.
   */
  private heightAt(c: RideCourse, s: number, i: number, iHull: number, descent: number): number {
    const tune = RIDE_PILOT;
    const left = c.total - s;
    const up = c.cutY + s * Math.tan(deg(tune.climbMax));
    const down = c.join.y + left * Math.tan(Math.max(descent, deg(tune.glideMin)));
    // The ground read in place, a sample not yet read standing at the highest read so far: through a call,
    // a hundred numbers a step handed back would be a hundred numbers the engine may box.
    const ground = c.ground;
    const unknown = this.highest;
    const lookTo = Math.min(c.n, i + Math.ceil(tune.look / c.step));
    let high = -Infinity;
    for (let k = i; k < lookTo; k++) {
      const g = ground[k];
      const h = g === g ? g : unknown;
      if (h > high) high = h;
    }
    const over = Math.max(0, c.join.y - (c.join.ground ?? c.seedGround));
    const atEnd = Math.max(high + over, c.join.y);
    const need = atEnd + (high + tune.clear - atEnd) * Math.max(0, Math.min(1, (left - tune.padNear) / Math.max(1, tune.padBlend)));
    const floorTo = Math.min(c.n - 1, i + Math.ceil(tune.floorAhead / c.step));
    let floor = -Infinity;
    for (let k = Math.min(iHull, floorTo); k <= floorTo; k++) {
      const g = ground[k];
      const h = g === g ? g : unknown;
      if (h > floor) floor = h;
    }
    const end = Math.min(s, c.total - s);
    const clearHere = tune.padClear + (tune.floor - tune.padClear) * Math.max(0, Math.min(1, (end - tune.padNear) / Math.max(1, tune.padBlend)));
    this.floorLine = floor + clearHere;
    let y = Math.max(floor + clearHere, Math.min(up, down, need));
    if (this.now < this.avoidUntil) y = Math.max(y, this.avoidY);
    this.target = y;
    return y;
  }

  /** Where it is, for the console. */
  report(): Record<string, unknown> {
    const c = this.course;
    const n1 = (n: number) => Number(n.toFixed(1));
    return c
      ? {
          word: c.word,
          radius: n1(c.radius),
          course: n1(c.total),
          along: n1(c.ss[this.progress] ?? 0),
          left: n1(c.total - (c.ss[this.progress] ?? 0)),
          wants: { height: n1(this.target), speed: n1(this.drive.cruise), stick: [Number(this.drive.stickX.toFixed(2)), Number(this.drive.stickY.toFixed(2))] },
          climbingOver: this.now < this.avoidUntil ? n1(this.avoidY) : null,
          goArounds: this.goArounds,
          joinError: { across: n1(this.joinError.across), up: n1(this.joinError.up), heading: n1(this.joinError.heading), speed: n1(this.joinError.speed) },
        }
      : { course: null, goArounds: this.goArounds };
  }
}

/** The sample at or before `s` along a course, looked for from `from` on (backwards too). */
function indexAt(c: RideCourse, s: number, from: number): number {
  let i = Math.max(0, Math.min(c.n - 2, from));
  while (i > 0 && c.ss[i] > s) i--;
  while (i < c.n - 2 && c.ss[i + 1] <= s) i++;
  return i;
}
