// The race view (the design's §5.12): what the mouse steers and where the camera stands while a pod, or a bike in
// racing mode, is ridden. The owner asked for "something between" the orbit and a chase: the mouse still steers, but
// it moves a heading target that never leads the nose by more than `steerLead`, and the hull turns toward it at its own
// maximum turn rate, so a flick of the mouse turns the pod a third of a right angle and no more, the same at every
// frame rate, and mouse moved faster than the pod can turn is thrown away. The camera is the orbit's own geometry with
// its yaw written from here: it trails the hull, leaning into the turn by a share of the lead, keeps the mouse's own
// pitch, stands further out and sees wider as the speed nears the ceiling, and lifts its focus over the pods' cockpits
// as they stand up and sit down at every start and stop. First person is the pilot's own eyes, with no ease (the game
// places it, `main.ts`); the widening reaches it too.
//
// Pure, so node runs it (`tools/swg/tests/raceView.test.ts`): the arithmetic here, the camera and the physics in the game.
// The seated eye, the first person's turn and the blocker are here too, written over the objects the game hands them,
// so the test runs the very lines the game does.
import type { Euler, Matrix4, Quaternion, Vector3 } from 'three';

/** What the race view keeps from frame to frame. Made once (`newRaceView`), written in place. */
export interface RaceViewState {
  /** Whether the race view had the camera last frame: the frame it takes over starts from the orbit as it stands. */
  on: boolean;
  /** The heading target (rad), NaN while there is none (Alt looking round): a number always, so writing it makes nothing. */
  target: number;
  /** The view's yaw (the orbit's convention, the hull's heading plus π), eased. */
  yaw: number;
  /** The distance's pull out with speed (1 at rest), eased. */
  pull: number;
  /** The third person's focus height in the hull's frame, eased. */
  focusY: number;
  /** The widening at speed (degrees), eased, and the widening the cascades were last fitted at. */
  fov: number;
  fitFov: number;
  /** What blocks the view: the clearance it is let out to, eased out and taken in at once (Infinity while clear). */
  clear: number;
}

export function newRaceView(): RaceViewState {
  // Every number a fraction first, so each field holds a number of its own and a frame writes it in place; then its start.
  const st = { on: false, target: Number.NaN, yaw: Math.PI, pull: 1.5, focusY: 0.5, fov: 0.5, fitFov: 0.5, clear: Infinity };
  st.pull = 1;
  st.focusY = 0;
  st.fov = 0;
  st.fitFov = 0;
  return st;
}

/** What a frame of the race view is handed. */
export interface RaceViewInput {
  /** The hull's heading now (rad). */
  heading: number;
  /** The mouse's sideways movement this frame (pixels; the caller spends it), and radians a pixel. */
  mouseDX: number;
  k: number;
  /** A or D steering: the target is the heading, so letting go never snaps back to an old aim. */
  keys: boolean;
  /** Alt held: the orbit looks round on its own and the target is dropped. */
  alt: boolean;
  /** The orbit's own yaw now: where a hand-over and Alt start from. */
  orbitYaw: number;
  /** The horizontal speed and the ceiling it is measured against (m/s). */
  speed: number;
  ceiling: number;
  /** The rider's seat's height in the hull's frame this frame (m). */
  seatY: number;
  /** The frame's seconds (the camera half's eases). */
  dt: number;
}

/** The numbers the race view reads (`RACE_TUNE`'s). */
export interface RaceViewTune {
  steerLead: number;
  camLag: number;
  camLook: number;
  camPull: number;
  camPullEase: number;
  pullFrom: number;
  eyeEase: number;
  fovAdd: number;
  fovFrom: number;
  fovEase: number;
  fovRefit: number;
}

/** What a frame of the race view gives back. Written in place. */
export interface RaceViewOut {
  /** The heading the drive steers toward, or NaN (Alt): the drive then steers by the keys alone. */
  target: number;
  /** The orbit's yaw to write before its update, and whether to write it (not while Alt looks round). */
  yaw: number;
  writeYaw: boolean;
  /** The distance's pull, the focus height in the hull's frame, the widening in degrees. */
  pull: number;
  focusY: number;
  speedFov: number;
  /** The cascades want fitting again: the widening moved `fovRefit` since they were last fitted. */
  refit: boolean;
  /** How far the target leads the nose (rad), and how far the view trails the hull's own back (degrees). */
  lead: number;
  trail: number;
}

export function newRaceViewOut(): RaceViewOut {
  const out = { target: Number.NaN, yaw: Math.PI, writeYaw: false, pull: 1.5, focusY: 0.5, speedFov: 0.5, refit: false, lead: 0.5, trail: 0.5 };
  out.pull = 1;
  out.focusY = 0;
  out.speedFov = 0;
  out.lead = 0;
  out.trail = 0;
  return out;
}

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const easeK = (dt: number, tau: number): number => 1 - Math.exp(-dt / Math.max(1e-6, tau));
/** Nought under `a`, one past `b`, smooth between. */
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / Math.max(1e-6, b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** The distance's pull at a share of the ceiling: one under `pullFrom`, `1 + camPull` at the ceiling. */
export function pullAt(share: number, tune: Pick<RaceViewTune, 'camPull' | 'pullFrom'>): number {
  return 1 + tune.camPull * smoothstep(tune.pullFrom, 1, share);
}

/** The widening at a share of the ceiling (degrees): nought under `fovFrom`, `fovAdd` at the ceiling, straight between. */
export function fovAt(share: number, tune: Pick<RaceViewTune, 'fovAdd' | 'fovFrom'>): number {
  return tune.fovAdd * clamp((share - tune.fovFrom) / Math.max(1e-6, 1 - tune.fovFrom), 0, 1);
}

/**
 * One frame of the race view, both halves: the steering (`steerRaceView`, which the game runs where the vehicles
 * step, before the drive reads its heading) and the camera (`frameRaceView`, which the game runs where the camera is
 * placed). The frame it takes over starts from the orbit as it stands (its yaw, and the target at the orbit's own aim
 * held within the lead), so switching never turns the pod.
 *
 * Both halves take records and hand back records, and work their arithmetic out in their own bodies: a number handed
 * to a call the compiler did not build into its caller is a number made, and the view is placed every frame.
 */
export function stepRaceView(st: RaceViewState, input: RaceViewInput, tune: RaceViewTune, out: RaceViewOut): RaceViewOut {
  steerRaceView(st, input, tune, out);
  return frameRaceView(st, input, tune, out);
}

/** The frame the race view takes the camera: from the orbit as it stands, its aim held within the lead of the nose. */
function takeOver(st: RaceViewState, input: RaceViewInput, tune: RaceViewTune): void {
  if (st.on) return;
  st.on = true;
  st.yaw = input.orbitYaw;
  // `cockpitYawStep` with no mouse: the orbit's aim (its yaw plus a half turn), held within the lead of the nose.
  let d = input.orbitYaw + Math.PI - input.heading;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  const lead = tune.steerLead;
  st.target = input.heading + (d < -lead ? -lead : d > lead ? lead : d);
  st.focusY = input.seatY;
  st.clear = Infinity;
}

/**
 * The steering half: the target dropped while Alt looks round, the heading while the keys steer, else moved by the
 * mouse as the orbit's yaw would be and held within the lead (the ship cockpit's own rule, `cockpitYawStep`).
 */
export function steerRaceView(st: RaceViewState, input: RaceViewInput, tune: RaceViewTune, out: RaceViewOut): RaceViewOut {
  takeOver(st, input, tune);
  const heading = input.heading;
  if (input.alt) st.target = Number.NaN;
  else if (input.keys) st.target = heading;
  else {
    // `cockpitYawStep`, written in: from the target (the heading when there is none) less the mouse, within the lead.
    const from = Number.isNaN(st.target) ? heading : st.target;
    let d = from - input.mouseDX * input.k - heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const lead = tune.steerLead;
    st.target = heading + (d < -lead ? -lead : d > lead ? lead : d);
  }
  out.target = st.target;
  if (Number.isNaN(st.target)) out.lead = 0;
  else {
    const l = st.target - heading;
    out.lead = Math.atan2(Math.sin(l), Math.cos(l));
  }
  return out;
}

/** The camera half: the eased yaw, the pull, the widening, the focus's height, and whether the cascades want fitting. */
export function frameRaceView(st: RaceViewState, input: RaceViewInput, tune: RaceViewTune, out: RaceViewOut): RaceViewOut {
  takeOver(st, input, tune);
  const heading = input.heading;
  const dt = input.dt;
  let lead = 0;
  if (!Number.isNaN(st.target)) {
    const l = st.target - heading;
    lead = Math.atan2(Math.sin(l), Math.cos(l));
  }
  // The yaw: behind the hull, leaning a share of the lead into the turn; while Alt looks round, the orbit's own, so
  // the race view eases back from wherever Alt left it.
  if (input.alt) st.yaw = input.orbitYaw;
  else {
    const want = heading + Math.PI + tune.camLook * lead;
    const e = want - st.yaw;
    st.yaw = st.yaw + Math.atan2(Math.sin(e), Math.cos(e)) * (1 - Math.exp(-dt / Math.max(1e-6, tune.camLag)));
  }
  const share = input.ceiling > 0 ? Math.abs(input.speed) / input.ceiling : 0;
  // `pullAt`, written in: one under `pullFrom`, `1 + camPull` at the ceiling, smooth between.
  let t = (share - tune.pullFrom) / Math.max(1e-6, 1 - tune.pullFrom);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const pull = 1 + tune.camPull * t * t * (3 - 2 * t);
  st.pull += (pull - st.pull) * (1 - Math.exp(-dt / Math.max(1e-6, tune.camPullEase)));
  // `fovAt` and `easeFov`, written in.
  let w = (share - tune.fovFrom) / Math.max(1e-6, 1 - tune.fovFrom);
  w = w < 0 ? 0 : w > 1 ? 1 : w;
  const wantFov = tune.fovAdd * w;
  let refit = false;
  if (!(wantFov === 0 && st.fov === 0 && st.fitFov === 0)) {
    st.fov += (wantFov - st.fov) * (1 - Math.exp(-dt / Math.max(1e-6, tune.fovEase)));
    if (wantFov === 0 && st.fov < 0.01) st.fov = 0;
    refit = Math.abs(st.fov - st.fitFov) >= tune.fovRefit || (st.fov === 0 && st.fitFov !== 0);
    if (refit) st.fitFov = st.fov;
  }
  out.refit = refit;
  st.focusY += (input.seatY - st.focusY) * (1 - Math.exp(-dt / Math.max(1e-6, tune.eyeEase)));
  out.target = st.target;
  out.yaw = st.yaw;
  out.writeYaw = !input.alt;
  out.pull = st.pull;
  out.focusY = st.focusY;
  out.speedFov = st.fov;
  out.lead = lead;
  const tr = st.yaw - (heading + Math.PI);
  out.trail = (Math.atan2(Math.sin(tr), Math.cos(tr)) * 180) / Math.PI;
  return out;
}

/**
 * The widening alone, for `view: 'orbit'`: eased toward what this share of the ceiling asks, with the frame's seconds
 * the record carries. Whether the cascades want fitting again.
 */
export function widenRaceView(st: RaceViewState, input: RaceViewInput, tune: Pick<RaceViewTune, 'fovAdd' | 'fovFrom' | 'fovEase' | 'fovRefit'>): boolean {
  return easeFov(st, fovAt(shareOf(input), tune), input.dt, tune);
}

/** The race view lets the camera go: the next frame it has it starts from the orbit again. The widening eases out on its own (`easeFovOut`). */
export function releaseRaceView(st: RaceViewState): void {
  st.on = false;
  st.target = Number.NaN;
  st.clear = Infinity;
}

/** The horizontal speed's share of the ceiling. */
export function shareOf(input: Pick<RaceViewInput, 'speed' | 'ceiling'>): number {
  return input.ceiling > 0 ? Math.abs(input.speed) / input.ceiling : 0;
}

/**
 * The widening eased toward `want` degrees, and whether the cascades want fitting again (it moved `fovRefit` since they
 * last were, or came back to nought). Under a hundredth of a degree on its way to nought it is nought, so the view comes
 * back to its base exactly; at nought and fitted at nought it changes nothing at all.
 */
export function easeFov(st: RaceViewState, want: number, dt: number, tune: Pick<RaceViewTune, 'fovEase' | 'fovRefit'>): boolean {
  if (want === 0 && st.fov === 0 && st.fitFov === 0) return false;
  st.fov += (want - st.fov) * easeK(dt, tune.fovEase);
  if (want === 0 && st.fov < 0.01) st.fov = 0;
  const refit = Math.abs(st.fov - st.fitFov) >= tune.fovRefit || (st.fov === 0 && st.fitFov !== 0);
  if (refit) st.fitFov = st.fov;
  return refit;
}

/** The widening eased back to nought with the race view off, and whether the cascades want fitting again. The game asks only while there is any. */
export function easeFovOut(st: RaceViewState, dt: number, tune: Pick<RaceViewTune, 'fovEase' | 'fovRefit'>): boolean {
  return easeFov(st, 0, dt, tune);
}
/**
 * The view's clearance from what blocks it: in at once (a wall is never seen from its far side), out again eased over
 * `camOut` once it is clear, so a trunk passing between the rider and the camera pulls the view in for a moment and
 * no more. `allowed` is how far the view may stand now (the line's length when clear); the answer is how far it does.
 */
export function easeClear(prev: number, allowed: number, dt: number, camOut: number): number {
  if (!(allowed < prev)) {
    if (!Number.isFinite(prev)) return allowed;
    return prev + (allowed - prev) * easeK(dt, camOut);
  }
  return allowed;
}

/** The orbit's own margin off whatever blocks it (m): the race view's clearance is the camera's distance, this put back on. */
export const RACE_BLOCK_MARGIN = 0.35;

/**
 * What blocks the race view this frame, the game's blocker in full (`raceBlock` in `main.ts` hands it the line's length
 * and the first thing standing still along it, Infinity for none): the clearance kept on `st`, in at once and out over
 * `camOut` (`easeClear`). True while it blocks, the camera then standing at `st.clear` plus `RACE_BLOCK_MARGIN`; false
 * once it is clear again, the clearance forgotten.
 */
export function raceBlocked(st: { clear: number }, len: number, d: number, dt: number, camOut: number): boolean {
  st.clear = easeClear(st.clear, d === Infinity ? len : Math.max(0.3, d - RACE_BLOCK_MARGIN), dt, camOut);
  if (st.clear >= len - 0.01) {
    st.clear = Infinity;
    return false;
  }
  return true;
}

/**
 * The rider's seated eye in the world, into `out`: the riding clip's first-frame eye in the figure's own frame (`local`,
 * which the rig measures, never the live bones), or with none the stock seated eye scaled by the figure's height,
 * carried through the figure's matrix as it hangs this very frame, with no ease. `local` may be `out` itself.
 */
export function raceEyeOf(local: Vector3 | null, fallback: readonly number[], scale: number, figure: Matrix4, out: Vector3): Vector3 {
  if (local) {
    if (local !== out) out.copy(local);
  } else out.fromArray(fallback as number[]).multiplyScalar(scale);
  return out.applyMatrix4(figure);
}

/** First person's turn, into `out`: the hull's own, with `fpRoll` of its roll (heading and pitch kept, YXZ). `euler` is scratch. */
export function raceTurnOf(hull: Quaternion, fpRoll: number, euler: Euler, out: Quaternion): Quaternion {
  out.copy(hull);
  if (fpRoll === 1) return out;
  euler.setFromQuaternion(out, 'YXZ');
  euler.z *= fpRoll;
  return out.setFromEuler(euler);
}
