// Another player's vehicle drawn where it is, not where it was: the picture is moved by the velocity their own game
// says it has, and eased onto the last place they sent carried forward by that state's age on the shared clock.
//
// Before this the picture was eased toward the last place heard with a tenth of a second's time constant and nothing
// else, so at speed it trailed the vehicle by the glide's own lag plus half the gap between states plus the way over
// the wire: a pod at 167 m/s drawn some 22 to 40 m behind where it was, a bike at 97 m/s 13 to 23. Moved by its own
// velocity the picture has no lag to make up, and the ease only takes off what the vehicle's turning and changing speed
// moved it off the line it was sent on.
//
// A state is carried forward by its age, which is read on the clock every player shares (the server's, the clock the
// weather and the nebulae's lightning read): the sender stamps the moment its place was true and every watcher
// measures from it, so when the state happened to be heard -- a few milliseconds early or late, bunched behind a busy
// frame -- moves nothing. With no clock shared (no server answering, a relay that came before), a state with no motion
// in it, or one whose age when it was heard is no age a clock that agrees could give, the picture glides as it always
// did: nothing new is used at all.
//
// The same step is the pose the grapple's rope rides on that vehicle (`src/player/grappleFrames.ts`): the rope asks
// this very function with the very state, the same moment and the same frame, so the rope drawn on the picture and the
// body it tows can never part.
//
// Pure: no three, no page, nothing allocated. The places and turns it is handed are read and written by their fields,
// which a three `Vector3` and `Quaternion` already are, and the numbers it is handed go in a kept record, since a number
// handed across a call the compiler did not build in is a number made, and the rope's frame makes nothing.

/** Anything with the three fields of a place. */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Anything with the four fields of a turn. */
export interface QuatLike {
  x: number;
  y: number;
  z: number;
  w: number;
}

/**
 * Every number of the reckoning, all ours and all live through `__debug.reckon({ tune })`. The ease is how the picture
 * feels; the three bounds are what a state's age may be before it is not believed.
 */
export const RECKON_TUNE = {
  /** The switch: off, every picture glides toward the last place heard as it did before. */
  on: true,
  /**
   * How quickly the picture takes off what the vehicle's turns and changes of speed put between it and the line it was
   * sent on (s, a time constant). The old glide's own tenth of a second: as quick to settle, with none of its lag.
   */
  ease: 0.1,
  /** Turn the picture by the sender's turn about straight up as well as moving it: a pod at speed turns hard. */
  turn: true,
  /**
   * The most a state is carried forward (s). A peer whose states stop (a hidden tab stops its game) is drawn where its
   * last one would have taken it this far on, and stands there, rather than gliding back to where it was heard.
   */
  most: 0.5,
  /**
   * The ages a state may have when it is heard before the clock that stamped it is not believed (s): a little under
   * nought for two clocks a few milliseconds apart over a quick line, and not past a second and a half for a slow one.
   * A state outside them is glided to, as before.
   */
  early: 0.25,
  trust: 1.5,
};

/** Set any of those, clamped to what makes sense; the answer is the table as it now stands. */
export function tuneReckon(o: Partial<typeof RECKON_TUNE>): typeof RECKON_TUNE {
  if (typeof o.on === 'boolean') RECKON_TUNE.on = o.on;
  if (typeof o.turn === 'boolean') RECKON_TUNE.turn = o.turn;
  if (typeof o.ease === 'number' && Number.isFinite(o.ease)) RECKON_TUNE.ease = Math.max(0.005, Math.min(2, o.ease));
  if (typeof o.most === 'number' && Number.isFinite(o.most)) RECKON_TUNE.most = Math.max(0, Math.min(5, o.most));
  if (typeof o.early === 'number' && Number.isFinite(o.early)) RECKON_TUNE.early = Math.max(0, Math.min(5, o.early));
  if (typeof o.trust === 'number' && Number.isFinite(o.trust)) RECKON_TUNE.trust = Math.max(0.05, Math.min(30, o.trust));
  return RECKON_TUNE;
}

/**
 * The last state of a peer's vehicle as it is reckoned from: the place and turn sent (`px`..`pz`, `qx`..`qw`), the
 * velocity and the turn about straight up its own game said it had (`vx`..`vz`, `yaw` rad/s), the moment its place was
 * true on the shared clock (`at`, ms), whether the state carried that motion at all (`has`), and whether its age when it
 * was heard was one a clock that agrees could give (`ok`). One kept record per vehicle, refilled as each state comes.
 */
export interface ReckonState {
  has: boolean;
  ok: boolean;
  px: number;
  py: number;
  pz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  at: number;
}

export function newReckonState(): ReckonState {
  // Every number begins as a fraction so its field holds a number of its own from the first and is written in place.
  const s = { has: false, ok: false, px: 0.5, py: 0.5, pz: 0.5, qx: 0.5, qy: 0.5, qz: 0.5, qw: 0.5, vx: 0.5, vy: 0.5, vz: 0.5, yaw: 0.5, at: 0.5 };
  s.px = 0;
  s.py = 0;
  s.pz = 0;
  s.qx = 0;
  s.qy = 0;
  s.qz = 0;
  s.qw = 1;
  s.vx = 0;
  s.vy = 0;
  s.vz = 0;
  s.yaw = 0;
  s.at = 0;
  return s;
}

/** One record's numbers copied into another, field by field. */
export function copyReckon(from: ReckonState, to: ReckonState): void {
  to.has = from.has;
  to.ok = from.ok;
  to.px = from.px;
  to.py = from.py;
  to.pz = from.pz;
  to.qx = from.qx;
  to.qy = from.qy;
  to.qz = from.qz;
  to.qw = from.qw;
  to.vx = from.vx;
  to.vy = from.vy;
  to.vz = from.vz;
  to.yaw = from.yaw;
  to.at = from.at;
}

/** What a state's `veh` may carry of its motion, as the wire has it (`server/vehicleWire.mjs`'s `cleanMotion`). */
export interface SentMotion {
  p: readonly number[];
  q: readonly number[];
  vl?: readonly number[];
  yr?: number;
  at?: number;
}

/**
 * A state heard, into the record: its place and turn always; its motion when it carried one that reads (three finite
 * numbers, a finite turn, a finite moment), else `has` false. `heardAt` is the shared clock's moment it was heard (ms),
 * NaN with no clock shared, and the state is believed (`ok`) only when its age then lies within `early` and `trust`.
 * Runs as a message is handled, never in a frame.
 */
export function readReckon(v: SentMotion, heardAt: number, out: ReckonState, tune = RECKON_TUNE): void {
  out.px = Number(v.p[0]);
  out.py = Number(v.p[1]);
  out.pz = Number(v.p[2]);
  const qx = Number(v.q[0]);
  const qy = Number(v.q[1]);
  const qz = Number(v.q[2]);
  const qw = Number(v.q[3]);
  const ql = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw) || 1;
  out.qx = qx / ql;
  out.qy = qy / ql;
  out.qz = qz / ql;
  out.qw = qw / ql;
  const vl = v.vl;
  const at = Number(v.at);
  const good = Array.isArray(vl) && vl.length === 3 && vl.every((n) => typeof n === 'number' && Number.isFinite(n)) && typeof v.at === 'number' && Number.isFinite(at);
  out.has = good;
  if (!good) {
    out.ok = false;
    out.vx = 0;
    out.vy = 0;
    out.vz = 0;
    out.yaw = 0;
    out.at = 0;
    return;
  }
  out.vx = vl![0];
  out.vy = vl![1];
  out.vz = vl![2];
  out.yaw = typeof v.yr === 'number' && Number.isFinite(v.yr) ? v.yr : 0;
  out.at = at;
  const age = (heardAt - at) / 1000;
  out.ok = Number.isFinite(age) && age >= -tune.early && age <= tune.trust;
}

/**
 * Whether a picture is reckoned this frame, and its state's age then (into `n[1]`, seconds): the switch on, a state
 * with its motion that was believed when heard, and a clock shared now (`n[2]`, the frame's moment on it in ms, NaN
 * with none). False leaves the picture to glide as before.
 */
export function reckonsIn(s: ReckonState, n: Float64Array, tune = RECKON_TUNE): boolean {
  const now = n[2];
  if (!tune.on || !s.has || !s.ok || !(now === now)) return false;
  n[1] = (now - s.at) / 1000;
  return true;
}

/** `reckonsIn`'s answer alone, for a reader that wants no age: the switch, a believed state with motion, a clock shared. */
export function reckonable(s: ReckonState | undefined, now: number, tune = RECKON_TUNE): boolean {
  return s !== undefined && tune.on && s.has && s.ok && now === now;
}

/**
 * How far a state's motion carries its place in `t` seconds, into `out` (three numbers): its velocity turning about
 * straight up at its turn rate the while (a pod at speed turns hard, and carried in a straight line its place would
 * stand outside the arc it is flying by the speed times the turn times the age squared over two -- four metres at a full
 * pod's top in its hardest turn). With no turn, the velocity times the time.
 */
function carriedIn(s: ReckonState, at: Float64Array, out: Float64Array): void {
  // The turn rate and the time come in a kept record: a number handed across a call not built in is a number made.
  const yaw = at[0];
  const t = at[1];
  const a = yaw * t;
  // The integrals of the velocity's turn, cos and sin of the angle, over the time; their series where the angle is small.
  let S: number;
  let K: number;
  if (Math.abs(a) < 1e-4) {
    S = t * (1 - (a * a) / 6);
    K = a * t * 0.5 * (1 - (a * a) / 12);
  } else {
    S = Math.sin(a) / yaw;
    K = (1 - Math.cos(a)) / yaw;
  }
  out[0] = s.vx * S + s.vz * K;
  out[1] = s.vy * t;
  out[2] = s.vz * S - s.vx * K;
}

const ARC_A = new Float64Array(3);
const ARC_B = new Float64Array(3);
const ARC_IN = new Float64Array(2);

/**
 * One frame of a reckoned picture, its place `p` and turn `q` written in place: `n[0]` the frame's seconds and `n[1]`
 * the state's age (`reckonsIn`). The place moves along the path the state's motion carries it on over the frame and
 * eases toward that path's place for the age, at `1 - exp(-dt / ease)`; the turn the same about straight up, by the turn
 * sent. With `turn` off the path is a straight line and the turn eases toward the one sent. Past `most` the state is
 * carried no further and the picture moves no more of its own, so a peer gone quiet stands where its last state would
 * have taken it. Nothing allocated.
 */
export function reckonStepIn(p: Vec3Like, q: QuatLike, s: ReckonState, n: Float64Array, tune = RECKON_TUNE): void {
  const dt = n[0];
  const age = n[1];
  const most = tune.most;
  const yaw = tune.turn ? s.yaw : 0;
  // The path's place at the frame's end and at its start, each carried no further than `most`.
  const carry = age < most ? age : most;
  const before = age - dt < most ? age - dt : most;
  ARC_IN[0] = yaw;
  ARC_IN[1] = carry;
  carriedIn(s, ARC_IN, ARC_A);
  ARC_IN[1] = before;
  carriedIn(s, ARC_IN, ARC_B);
  p.x += ARC_A[0] - ARC_B[0];
  p.y += ARC_A[1] - ARC_B[1];
  p.z += ARC_A[2] - ARC_B[2];
  const k = dt > 0 ? 1 - Math.exp(-dt / tune.ease) : 0;
  p.x += (s.px + ARC_A[0] - p.x) * k;
  p.y += (s.py + ARC_A[1] - p.y) * k;
  p.z += (s.pz + ARC_A[2] - p.z) * k;
  // The turn sent, carried by the turn sent for the age: a turn about straight up laid on before it. Into a kept record
  // with the ease's share, which the slerp reads (numbers handed across a call not built in are numbers made).
  let ty = yaw * carry * 0.5;
  let sy = Math.sin(ty);
  let cy = Math.cos(ty);
  const b = TURN_B;
  b[0] = cy * s.qx + sy * s.qz;
  b[1] = cy * s.qy + sy * s.qw;
  b[2] = cy * s.qz - sy * s.qx;
  b[3] = cy * s.qw - sy * s.qy;
  b[4] = k;
  const turned = carry - before;
  if (yaw !== 0 && turned !== 0) {
    // The picture's own turn over the frame, about straight up, laid on before its turn.
    ty = yaw * turned * 0.5;
    sy = Math.sin(ty);
    cy = Math.cos(ty);
    const x = q.x;
    const y = q.y;
    const z = q.z;
    const w = q.w;
    q.x = cy * x + sy * z;
    q.y = cy * y + sy * w;
    q.z = cy * z - sy * x;
    q.w = cy * w - sy * y;
  }
  slerpInto(q, b);
}

/** The turn a slerp eases toward and its share, kept (`slerpInto`). */
const TURN_B = new Float64Array(5);

/**
 * A turn eased `b[4]` of the way toward (`b[0]`..`b[3]`), the shorter way round, written in place: three's own slerp,
 * written out so the reckoning needs nothing of three.
 */
function slerpInto(q: QuatLike, b: Float64Array): void {
  let bx = b[0];
  let by = b[1];
  let bz = b[2];
  let bw = b[3];
  const k = b[4];
  if (k <= 0) return;
  if (k >= 1) {
    q.x = bx;
    q.y = by;
    q.z = bz;
    q.w = bw;
    return;
  }
  const x = q.x;
  const y = q.y;
  const z = q.z;
  const w = q.w;
  let cos = w * bw + x * bx + y * by + z * bz;
  if (cos < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
    cos = -cos;
  }
  if (cos >= 1) return;
  const sqrSin = 1 - cos * cos;
  if (sqrSin <= Number.EPSILON) {
    const s = 1 - k;
    let nx = s * x + k * bx;
    let ny = s * y + k * by;
    let nz = s * z + k * bz;
    let nw = s * w + k * bw;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    nw /= l;
    q.x = nx;
    q.y = ny;
    q.z = nz;
    q.w = nw;
    return;
  }
  const sin = Math.sqrt(sqrSin);
  const half = Math.atan2(sin, cos);
  const ra = Math.sin((1 - k) * half) / sin;
  const rb = Math.sin(k * half) / sin;
  q.x = x * ra + bx * rb;
  q.y = y * ra + by * rb;
  q.z = z * ra + bz * rb;
  q.w = w * ra + bw * rb;
}

/**
 * The moment the place sent with a state was true, on the shared clock (ms). A state goes out before its frame's own
 * physics step (`App.stepNet` runs before `Physics.step`), so the place it carries is the one the frame before's step
 * left: true at the sender's frame's start on that clock, less the frame's own step (`step`, the seconds this frame's
 * physics step is about to take up and the bodies have not taken yet), less how far the bodies stood behind even that
 * (`behind`, `Physics.behind`, the accumulator's remainder after the last fixed step). Stamped at the frame's start
 * alone, every picture stood the sender's speed times its frame time behind where it was: a twelfth of the speed at
 * 144 fps, a thirtieth at 30. `sharedNow` is the clock read as the state is made, `sinceFrame` how long ago the frame
 * started (ms), `step` and `behind` seconds. A frame the loop clamped to a twentieth of a second stamps late by what the
 * clamp took off, which is time the sender's own game lost; the next state puts it right and the ease takes it up.
 */
export function placeMoment(sharedNow: number, sinceFrame: number, step: number, behind: number): number {
  return sharedNow - Math.max(0, sinceFrame) - Math.max(0, step) * 1000 - Math.max(0, behind) * 1000;
}

/**
 * A turn the sender's game wrote this frame carried back to the one its body stood at beside the place it sends: turned
 * about straight up by the turn rate times `seconds` the other way, written in place. A race drive and a flown ship write
 * their turn on the body as the frame begins its own step, a frame ahead of the place the frame before's step left, so
 * sent as written the turn would stand a frame's turning ahead of its place (a degree and a half for a pod in its
 * hardest turn at 60 fps). Their velocity is not turned back: it is the one the coming step moves the body by, which is
 * the way the place sent goes on. Nothing allocated.
 */
export function turnBack(q: QuatLike, yaw: number, seconds: number): void {
  const half = -yaw * seconds * 0.5;
  if (half === 0 || !Number.isFinite(half)) return;
  const s = Math.sin(half);
  const c = Math.cos(half);
  const x = q.x;
  const y = q.y;
  const z = q.z;
  const w = q.w;
  q.x = c * x + s * z;
  q.y = c * y + s * w;
  q.z = c * z - s * x;
  q.w = c * w - s * y;
}
