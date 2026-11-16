// The stair clips played round, one footfall a step (the stairs wave, part B; the owner's 2026-11-15: "find parts of the
// stair animations that loop and trim them so it only plays one step per stair").
//
// Each stair clip's window is measured on the human male's own rig (tools/swg/tests/stairCycleSearch.ts) and kept here
// with the numbers that chose it (`STAIR_WINDOWS`), which `stairCycles.test.ts` measures again:
//  - a clip with two footfalls (both upstairs clips) is a cycle of two steps: the window that loops best, from where the
//    ankles, knees and hips stand nearest to where they stood at its start, and moving the same way;
//  - a clip with one footfall (both downstairs clips) is one step of the left foot: the window whose end stands nearest the
//    mirror of its start, and the right foot's step is that window mirrored (`stairs.mirror` 'legs': the legs and hips
//    mirrored, the spine, arms and head keeping the clip's own turn in the figure's frame; 'whole': every joint), so the
//    two make one cycle of two footfalls.
// Whatever is left of a seam (the window's end against its loop's start, or against the mirror of its start) is spread
// over the window, a share of it at each moment from none at the start to all of it at the end: each joint's turn in the
// figure's frame and the hips' place (which is how the clip's net rise or fall over the window is taken out, as the game
// plays stairs today: the body's height is the ground's). Every seam then meets to the float.
//
// What the game plays then: `mx_<id>~trimmed`, `mx_<id>~legs` and `mx_<id>~whole`, made once a skeleton beside the pack's
// own clips (`stairCyclesFor`, which the rig takes in `attachImportedClips`) and kept, with each one's facts measured on
// that skeleton (`StairCycleFacts`: its length, its footfalls, the foot's place as it lands, its step along and its rise),
// which the stairs' step (src/anim/stairStep.ts) drives its phase by. The clips untrimmed are measured the same way, so
// a step can be driven on them too (`stairs.cycle` 'before', or `stairs.mirror` 'off' for the downstairs clips).
//
// Nothing here runs on a frame: the clips and their facts are made once, when the rig takes the pack's clips.

import * as THREE from 'three';
import type { TargetSkeleton } from './fit.ts';
import { restWorld } from './fit.ts';

/** A clip's window and what chose it (measured on the human male; see the header). */
export interface StairWindow {
  /** The window, seconds of the fitted clip. */
  t0: number;
  t1: number;
  /** One footfall in the clip (a cycle made of it and its mirror), or two (the window is a cycle). */
  one: boolean;
  /** The seam before it was spread: the worst of the legs' points (ankles, knees, toes, thighs, against the hips), mm, and their speed's, m/s. */
  seamMm: number;
  seamVel: number;
  /** The clip's own roughness (`roughness`): the worst change of those points' speeds from one of its frames to the next, m/s. A seam's speed is held under it. */
  rough?: number;
  /** A running clip (the jog and faster's): a step may take a tread more to keep its rate in the band (`StairStep`'s `upAt`). */
  run: boolean;
}

/**
 * The measured windows (generated in node on the human male by tools/swg/tests/stairCycleSearch.ts; `stairCycles.test.ts`
 * measures them again). Both upstairs clips loop best whole: their own wrap is the least seam (ascending 9.9 mm and 1.03
 * m/s, running 2.3 mm and 1.21 m/s, each under the clip's own frame-to-frame roughness, 1.44 and 3.01 m/s), so trimmed
 * they are the clip with its seam spread to nothing. Both downstairs clips step down with the left foot and bring the right
 * foot to the same tread (a step to, not a step through): no window ends near its own start mirrored (the least, 258 and
 * 246 mm, is the right leg a riser short of where the mirror puts it), so spread, their right leg reaches the riser lower,
 * and their cycle steps down by its legs alone (its hips keep their height over the stairs' line, part A).
 */
export const STAIR_WINDOWS: Readonly<Record<string, StairWindow>> = {
  ascending_stairs: { t0: 0, t1: 1.367, one: false, seamMm: 9.9, seamVel: 1.028, rough: 1.44, run: false },
  running_up_stairs: { t0: 0, t1: 0.583, one: false, seamMm: 2.3, seamVel: 1.211, rough: 3.01, run: true },
  descending_stairs_1: { t0: 0.133, t1: 0.617, one: true, seamMm: 257.7, seamVel: 0.684, rough: 1.64, run: false },
  descending_stairs: { t0: 0.067, t1: 0.283, one: true, seamMm: 245.6, seamVel: 1.372, rough: 4.42, run: true },
};

export type CycleKind = 'trimmed' | 'legs' | 'whole';
/** A cycle's clip name on a rig. */
export const cycleName = (id: string, kind: CycleKind): string => `mx_${id}~${kind}`;

/** The joints the 'legs' mirror takes: the hips and both legs. */
export const LEG_JOINTS: readonly string[] = ['root', 'lThigh', 'rThigh', 'lShin', 'rShin', 'lAnkle', 'rAnkle', 'lToe', 'rToe'];
/**
 * How far apart a seam's speeds are read, seconds: the clips' own frame (they are made at 30 a second, and a joint's turn
 * goes straight between two keys, so a point's speed steps at every key: read closer, a seam is held to a finer
 * standard than the clip's every frame meets).
 */
export const SEAM_DT = 1 / 30;
/** The points a seam is measured by (each against the hips): the legs'. */
export const SEAM_POINTS: readonly string[] = ['lThigh', 'rThigh', 'lShin', 'rShin', 'lAnkle', 'rAnkle', 'lToe', 'rToe'];

/** A joint's mirror partner by name: `l<Upper>` and `r<Upper>`, `<x>_l` and `<x>_r`; itself where it has none. */
export function partnerName(name: string): string {
  if (/^[lr][A-Z]/.test(name)) return (name[0] === 'l' ? 'r' : 'l') + name.slice(1);
  if (/_[lr]$/.test(name)) return name.slice(0, -1) + (name.endsWith('l') ? 'r' : 'l');
  return name;
}

/**
 * A cycle's facts, measured on the skeleton it was made for (its own metres, at the figure's scale 1): what the stairs'
 * step drives its phase by. (Declared as fractions.)
 */
export class StairCycleFacts {
  /** The clip's name and its seconds. */
  name = '';
  len = 0.5;
  /** Footfalls (steps) a cycle: 2 for a cycle, 1 for a downstairs clip played as it stands (`stairs.mirror` 'off'). */
  steps = 1;
  /** Each footfall: its time in the cycle (the landing foot's forward-most moment), the foot (0 left, 1 right), and the ankle's place along the figure's front from its origin as it lands. */
  readonly at = new Float64Array(2);
  readonly side = new Int32Array(2);
  readonly off = new Float64Array(2);
  /** The landing foot's middle (a quarter of the way from its ankle to its toe's tip... its sole's middle: a quarter the ankle, three quarters the toe joint) ahead of its ankle along the front, metres: what lands on a tread's spot. */
  readonly mid = new Float64Array(2);
  /** A running clip (the window's `run`). */
  run = false;
  /** The clip's own step: how far along a planted foot goes back a step (the body's step on the ground with the foot still), and how far it falls a step (the clip's rise), metres. */
  fwd = 0.5;
  rise = 0.5;
  /** Measured, the console's: the seam's worst gap after the spread (m) and its speed's (m/s). */
  seam = 0.5;
  seamVel = 0.5;
}

// ---- quaternions on plain arrays ---------------------------------------------------------------------------------------

function qmulInto(o: Float64Array, oi: number, a: ArrayLike<number>, ai: number, b: ArrayLike<number>, bi: number): void {
  const ax = a[ai], ay = a[ai + 1], az = a[ai + 2], aw = a[ai + 3];
  const bx = b[bi], by = b[bi + 1], bz = b[bi + 2], bw = b[bi + 3];
  o[oi] = ax * bw + aw * bx + ay * bz - az * by;
  o[oi + 1] = ay * bw + aw * by + az * bx - ax * bz;
  o[oi + 2] = az * bw + aw * bz + ax * by - ay * bx;
  o[oi + 3] = aw * bw - ax * bx - ay * by - az * bz;
}
/** The conjugate of a unit quaternion at `bi`, written into `o` at `oi`. */
function qconjInto(o: Float64Array, oi: number, b: ArrayLike<number>, bi: number): void {
  o[oi] = -b[bi];
  o[oi + 1] = -b[bi + 1];
  o[oi + 2] = -b[bi + 2];
  o[oi + 3] = b[bi + 3];
}
/** A turn mirrored across the figure's left-right plane (x = 0): (x, -y, -z, w). */
function qmirrorInto(o: Float64Array, oi: number, b: ArrayLike<number>, bi: number): void {
  o[oi] = b[bi];
  o[oi + 1] = -b[bi + 1];
  o[oi + 2] = -b[bi + 2];
  o[oi + 3] = b[bi + 3];
}
function rotInto(o: Float64Array, oi: number, q: ArrayLike<number>, qi: number, x: number, y: number, z: number): void {
  const qx = q[qi], qy = q[qi + 1], qz = q[qi + 2], qw = q[qi + 3];
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  o[oi] = x + qw * tx + (qy * tz - qz * ty);
  o[oi + 1] = y + qw * ty + (qz * tx - qx * tz);
  o[oi + 2] = z + qw * tz + (qx * ty - qy * tx);
}
/** A share `u` of the turn `d` (from none), times `q`: slerp(1, d, u) * q, into `o`. */
function partOfInto(o: Float64Array, oi: number, d: ArrayLike<number>, di: number, u: number, q: ArrayLike<number>, qi: number): void {
  let dx = d[di], dy = d[di + 1], dz = d[di + 2], dw = d[di + 3];
  if (dw < 0) {
    dx = -dx;
    dy = -dy;
    dz = -dz;
    dw = -dw;
  }
  const s = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const half = Math.atan2(s, dw);
  const k = s > 1e-12 ? Math.sin(half * u) / s : u;
  const p = [dx * k, dy * k, dz * k, Math.cos(half * u)];
  qmulInto(o, oi, p, 0, q, qi);
}

// ---- a clip posed in the figure's frame ---------------------------------------------------------------------------------

/** A skeleton's joints, as the builder reads them. */
interface Bones {
  n: number;
  names: string[];
  parent: Int32Array;
  partner: Int32Array;
  restQ: Float64Array;
  restP: Float64Array;
  baseQ: Float64Array;
  baseP: Float64Array;
  /** The rest pose's turns in the figure's frame, and each joint's mirror correction (mirror(rest of partner)^-1 * rest). */
  restW: Float64Array;
  K: Float64Array;
  root: number;
}

function bonesOf(skel: TargetSkeleton): Bones {
  const n = skel.joints.length;
  const names = skel.joints.map((j) => j.name);
  const parent = new Int32Array(n);
  const partner = new Int32Array(n);
  const restQ = new Float64Array(n * 4);
  const restP = new Float64Array(n * 3);
  skel.joints.forEach((j, i) => {
    parent[i] = j.parent;
    const pn = partnerName(j.name);
    const pi = names.indexOf(pn);
    partner[i] = pi >= 0 ? pi : i;
    for (let c = 0; c < 4; c++) restQ[i * 4 + c] = j.restQ[c];
    for (let c = 0; c < 3; c++) restP[i * 3 + c] = j.restP[c];
  });
  const rw = restWorld(skel);
  const restW = Float64Array.from(rw.q);
  const K = new Float64Array(n * 4);
  const m = new Float64Array(4);
  const mi = new Float64Array(4);
  for (let i = 0; i < n; i++) {
    qmirrorInto(m, 0, restW, partner[i] * 4);
    qconjInto(mi, 0, m, 0);
    qmulInto(K, i * 4, mi, 0, restW, i * 4);
  }
  const root = names.indexOf('root') >= 0 ? names.indexOf('root') : 0;
  return { n, names, parent, partner, restQ, restP, baseQ: Float64Array.from(skel.base.q), baseP: Float64Array.from(skel.base.p), restW, K, root };
}

/** One sampled pose: every joint's turn in the figure's frame, and the root joint's place in its parent's frame. */
interface Pose {
  w: Float64Array;
  p: Float64Array;
}

/** A track's own interpolant (three makes one per track the way the mixer reads it; its types do not list the maker). */
const interpolantOf = (t: THREE.KeyframeTrack): THREE.Interpolant => (t as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant();

/** A clip's tracks read at any time (three's own interpolants: the rig plays them the same way). */
class Sampler {
  readonly b: Bones;
  private readonly q: (THREE.Interpolant | null)[];
  private readonly pos: THREE.Interpolant | null;
  readonly tracked: boolean[];
  constructor(clip: THREE.AnimationClip, b: Bones) {
    this.b = b;
    this.q = b.names.map(() => null);
    this.tracked = b.names.map(() => false);
    let pos: THREE.Interpolant | null = null;
    for (const t of clip.tracks) {
      const dot = t.name.lastIndexOf('.');
      const joint = b.names.indexOf(t.name.slice(0, dot));
      if (joint < 0) continue;
      if (t.name.endsWith('.quaternion')) {
        this.q[joint] = interpolantOf(t);
        this.tracked[joint] = true;
      } else if (t.name.endsWith('.position') && joint === b.root) pos = interpolantOf(t);
    }
    this.pos = pos;
  }
  /** The pose at `t`, into `out` (its turns in the figure's frame). */
  at(t: number, out: Pose): void {
    const b = this.b;
    const local = new Float64Array(4);
    for (let j = 0; j < b.n; j++) {
      const ip = this.q[j];
      if (ip) {
        const r = ip.evaluate(t);
        for (let c = 0; c < 4; c++) local[c] = r[c];
      } else for (let c = 0; c < 4; c++) local[c] = b.restQ[j * 4 + c];
      const k = b.parent[j];
      if (k < 0) qmulInto(out.w, j * 4, b.baseQ, 0, local, 0);
      else qmulInto(out.w, j * 4, out.w, k * 4, local, 0);
    }
    if (this.pos) {
      const r = this.pos.evaluate(t);
      out.p[0] = r[0];
      out.p[1] = r[1];
      out.p[2] = r[2];
    } else for (let c = 0; c < 3; c++) out.p[c] = b.restP[b.root * 3 + c];
  }
}

const newPose = (b: Bones): Pose => ({ w: new Float64Array(b.n * 4), p: new Float64Array(3) });

/** Every joint's place in the figure's frame for a pose, into `out` (n * 3). */
export function placesOf(b: Bones, pose: Pose, out: Float64Array): void {
  for (let j = 0; j < b.n; j++) {
    const k = b.parent[j];
    const lp = j === b.root ? pose.p : null;
    const x = lp ? lp[0] : b.restP[j * 3];
    const y = lp ? lp[1] : b.restP[j * 3 + 1];
    const z = lp ? lp[2] : b.restP[j * 3 + 2];
    if (k < 0) {
      rotInto(out, j * 3, b.baseQ, 0, x, y, z);
      out[j * 3] += b.baseP[0];
      out[j * 3 + 1] += b.baseP[1];
      out[j * 3 + 2] += b.baseP[2];
    } else {
      rotInto(out, j * 3, pose.w, k * 4, x, y, z);
      out[j * 3] += out[k * 3];
      out[j * 3 + 1] += out[k * 3 + 1];
      out[j * 3 + 2] += out[k * 3 + 2];
    }
  }
}

/** The root joint's place mirrored across the figure's left-right plane, in its parent's frame (the base's). */
function mirrorRootPlace(b: Bones, p: ArrayLike<number>, out: Float64Array): void {
  const v = new Float64Array(3);
  rotInto(v, 0, b.baseQ, 0, p[0], p[1], p[2]);
  const fx = -(v[0] + b.baseP[0]) - b.baseP[0];
  const fy = v[1];
  const fz = v[2];
  const inv = new Float64Array(4);
  qconjInto(inv, 0, b.baseQ, 0);
  rotInto(out, 0, inv, 0, fx, fy, fz);
}

/** A pose mirrored: every joint (`whole`) or the legs' (`legs`; the rest kept as `keep` has them), into `out`. */
function mirrorPose(b: Bones, src: Pose, keep: Pose, legs: boolean, legSet: boolean[], out: Pose): void {
  const m = new Float64Array(4);
  for (let j = 0; j < b.n; j++) {
    if (legs && !legSet[j]) {
      for (let c = 0; c < 4; c++) out.w[j * 4 + c] = keep.w[j * 4 + c];
      continue;
    }
    qmirrorInto(m, 0, src.w, b.partner[j] * 4);
    qmulInto(out.w, j * 4, m, 0, b.K, j * 4);
  }
  mirrorRootPlace(b, src.p, out.p);
}

// ---- the clip made ------------------------------------------------------------------------------------------------------

/** The rate the cycles are sampled at, frames a second. */
const RATE = 60;

/**
 * A cycle made of a fitted clip's window: 'trimmed' the window spread to loop on itself, 'legs' and 'whole' the window
 * spread to end on its own start mirrored, then followed by its mirror (two steps). Null where the skeleton lacks the
 * legs' joints.
 */
export function buildCycle(clip: THREE.AnimationClip, skel: TargetSkeleton, id: string, kind: CycleKind, win: StairWindow): THREE.AnimationClip | null {
  const b = bonesOf(skel);
  if (LEG_JOINTS.some((n) => b.names.indexOf(n) < 0)) return null;
  const legSet = b.names.map((n) => LEG_JOINTS.includes(n));
  const s = new Sampler(clip, b);
  const t0 = Math.max(0, Math.min(clip.duration, win.t0));
  const t1 = Math.max(t0 + 1e-3, Math.min(clip.duration, win.t1));
  const L = t1 - t0;
  const N = Math.max(2, Math.round(L * RATE));
  const mirror = kind !== 'trimmed';
  const start = newPose(b);
  const end = newPose(b);
  s.at(t0, start);
  s.at(t1, end);
  // The seam's target: the start itself (a loop) or the start mirrored.
  const target = newPose(b);
  if (mirror) mirrorPose(b, start, start, kind === 'legs', legSet, target);
  else {
    target.w.set(start.w);
    target.p.set(start.p);
  }
  // Each joint's turn from the end to the target, and the hips' place.
  const D = new Float64Array(b.n * 4);
  const inv = new Float64Array(4);
  for (let j = 0; j < b.n; j++) {
    qconjInto(inv, 0, end.w, j * 4);
    qmulInto(D, j * 4, target.w, j * 4, inv, 0);
  }
  const dp = [target.p[0] - end.p[0], target.p[1] - end.p[1], target.p[2] - end.p[2]];
  // The window's poses, spread.
  const half: Pose[] = [];
  const raw = newPose(b);
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    s.at(t0 + L * u, raw);
    const out = newPose(b);
    for (let j = 0; j < b.n; j++) partOfInto(out.w, j * 4, D, j * 4, u, raw.w, j * 4);
    for (let c = 0; c < 3; c++) out.p[c] = raw.p[c] + dp[c] * u;
    half.push(out);
  }
  const poses: Pose[] = half.slice();
  if (mirror) {
    for (let i = 1; i <= N; i++) {
      const out = newPose(b);
      mirrorPose(b, half[i], half[i], kind === 'legs', legSet, out);
      poses.push(out);
    }
  }
  const frames = poses.length;
  const duration = mirror ? 2 * L : L;
  const times = new Float32Array(frames);
  for (let i = 0; i < frames; i++) times[i] = (duration * i) / (frames - 1);
  const tracks: THREE.KeyframeTrack[] = [];
  const local = new Float64Array(4);
  for (let j = 0; j < b.n; j++) {
    // A joint the clip drives, and under 'legs' every joint whose parent's turn the mirror changed (its local changes).
    if (!s.tracked[j]) continue;
    const values = new Float32Array(frames * 4);
    const k = b.parent[j];
    for (let f = 0; f < frames; f++) {
      const w = poses[f].w;
      if (k < 0) qconjInto(inv, 0, b.baseQ, 0);
      else qconjInto(inv, 0, w, k * 4);
      qmulInto(local, 0, inv, 0, w, j * 4);
      // One sign down the frames.
      if (f > 0 && values[f * 4 - 4] * local[0] + values[f * 4 - 3] * local[1] + values[f * 4 - 2] * local[2] + values[f * 4 - 1] * local[3] < 0) for (let c = 0; c < 4; c++) local[c] = -local[c];
      const len = Math.hypot(local[0], local[1], local[2], local[3]) || 1;
      for (let c = 0; c < 4; c++) values[f * 4 + c] = local[c] / len;
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${b.names[j]}.quaternion`, times, values));
  }
  const pv = new Float32Array(frames * 3);
  for (let f = 0; f < frames; f++) for (let c = 0; c < 3; c++) pv[f * 3 + c] = poses[f].p[c];
  tracks.push(new THREE.VectorKeyframeTrack(`${b.names[b.root]}.position`, times, pv));
  return new THREE.AnimationClip(cycleName(id, kind), duration, tracks);
}

// ---- the facts ----------------------------------------------------------------------------------------------------------

/** How fast an ankle goes back along the figure's front for it to stand (`ik.stairBack`'s start), m/s. */
const STANCE = 0.1;

/**
 * A cycle's facts measured on its skeleton: its footfalls (the moments a foot comes forward-most and then goes back, the
 * figure's front being +z in its own frame), each one's ankle place as it lands, and the clip's own step (a planted
 * ankle's median speed back along the front, and down for the rise, times a step's seconds). `steps` the footfalls the
 * cycle holds that change the level: 2, or 1 for a downstairs clip as it stands (its second "footfall" brings the other
 * foot to the same tread).
 */
export function measureCycle(clip: THREE.AnimationClip, skel: TargetSkeleton, steps: number): StairCycleFacts | null {
  const b = bonesOf(skel);
  const ia = [b.names.indexOf('lAnkle'), b.names.indexOf('rAnkle')];
  const it = [b.names.indexOf('lToe'), b.names.indexOf('rToe')];
  if (ia[0] < 0 || ia[1] < 0) return null;
  const s = new Sampler(clip, b);
  const N = Math.max(8, Math.round(clip.duration * 240));
  const dt = clip.duration / N;
  const pose = newPose(b);
  const places = new Float64Array(b.n * 3);
  const along = [new Float64Array(N + 1), new Float64Array(N + 1)];
  const toe = [new Float64Array(N + 1), new Float64Array(N + 1)];
  const up = [new Float64Array(N + 1), new Float64Array(N + 1)];
  for (let i = 0; i <= N; i++) {
    s.at(Math.min(clip.duration, i * dt), pose);
    placesOf(b, pose, places);
    for (let f = 0; f < 2; f++) {
      along[f][i] = places[ia[f] * 3 + 2];
      toe[f][i] = it[f] >= 0 ? places[it[f] * 3 + 2] : along[f][i];
      up[f][i] = places[ia[f] * 3 + 1];
    }
  }
  const facts = new StairCycleFacts();
  facts.name = clip.name;
  facts.len = clip.duration;
  facts.steps = steps;
  // Each foot's footfall: its forward-most moment that the foot then goes back from (the cycle read round).
  const falls: { t: number; f: number; off: number; mid: number }[] = [];
  for (let f = 0; f < 2; f++) {
    const a = along[f];
    for (let i = 0; i < N; i++) {
      const p = a[(i + N - 1) % N];
      const q = a[(i + 1) % N];
      if (a[i] >= p && a[i] > q && (a[i] - a[(i + 6) % N]) / (6 * dt) > STANCE) falls.push({ t: i * dt, f, off: a[i], mid: 0.75 * (toe[f][i] - a[i]) });
    }
  }
  // The step's speeds: each planted ankle's speed back along, and down, over the frames it stands.
  const back: number[] = [];
  const down: number[] = [];
  for (let f = 0; f < 2; f++) {
    for (let i = 0; i < N; i++) {
      const v = -(along[f][i + 1] - along[f][i]) / dt;
      if (v > STANCE) {
        back.push(v);
        down.push(-(up[f][i + 1] - up[f][i]) / dt);
      }
    }
  }
  const median = (x: number[]) => {
    if (!x.length) return 0;
    const y = x.slice().sort((p, q) => p - q);
    return y[y.length >> 1];
  };
  const stepT = clip.duration / steps;
  facts.fwd = median(back) * stepT;
  facts.rise = median(down) * stepT;
  // The footfalls the cycle steps by: for two, one of each foot (each foot's most marked); for one, the left foot's.
  const pick = (f: number) => {
    const mine = falls.filter((x) => x.f === f);
    if (!mine.length) return null;
    // The one followed by the longest stance (the foot's real landing, not a toe's flick).
    let best = mine[0];
    let bestRun = -1;
    for (const x of mine) {
      let run = 0;
      const i0 = Math.round(x.t / dt);
      while (run < N && -(along[f][(i0 + run + 1) % N] - along[f][(i0 + run) % N]) / dt > STANCE * 0.5) run++;
      if (run > bestRun) {
        bestRun = run;
        best = x;
      }
    }
    return best;
  };
  const L0 = pick(0);
  const R0 = pick(1);
  if (steps === 1) {
    const x = L0 ?? R0;
    if (!x) return null;
    facts.at[0] = x.t;
    facts.side[0] = x.f;
    facts.off[0] = x.off;
    facts.mid[0] = x.mid;
  } else {
    if (!L0 || !R0) return null;
    const first = L0.t <= R0.t ? L0 : R0;
    const second = first === L0 ? R0 : L0;
    facts.at[0] = first.t;
    facts.side[0] = first.f;
    facts.off[0] = first.off;
    facts.mid[0] = first.mid;
    facts.at[1] = second.t;
    facts.side[1] = second.f;
    facts.off[1] = second.off;
    facts.mid[1] = second.mid;
    // A cycle of two steps: the step is how far each landing foot goes back over the step it stands through (from its own
    // footfall to the other foot's), both feet's mean: exactly what the body must go a step for the foot to stay where it
    // landed (its median speed times a step's seconds read the stance's uneven pace as an even one).
    let sum = 0;
    for (let k = 0; k < 2; k++) {
      const f = facts.side[k];
      const i0 = Math.round(facts.at[k] / dt) % N;
      const i1 = Math.round(facts.at[1 - k] / dt) % N;
      sum += along[f][i0] - along[f][i1];
    }
    facts.fwd = sum / 2;
  }
  return facts;
}

/** The seam of a clip played round: the legs' points against the hips at its end against its start, worst gap (m) and its speed's (m/s). */
export function seamOf(clip: THREE.AnimationClip, skel: TargetSkeleton): { gap: number; vel: number } {
  const b = bonesOf(skel);
  const s = new Sampler(clip, b);
  const pose = newPose(b);
  const P = new Float64Array(b.n * 3);
  const h = SEAM_DT;
  const T = clip.duration;
  const at = (t: number) => {
    s.at(t, pose);
    placesOf(b, pose, P);
    const out: number[] = [];
    const r = b.root * 3;
    for (const n of SEAM_POINTS) {
      const j = b.names.indexOf(n) * 3;
      out.push(P[j] - P[r], P[j + 1] - P[r + 1], P[j + 2] - P[r + 2]);
    }
    return out;
  };
  const a0 = at(0), a1 = at(h), e0 = at(T), e1 = at(T - h);
  let gap = 0;
  let vel = 0;
  for (let i = 0; i < a0.length; i += 3) {
    gap = Math.max(gap, Math.hypot(a0[i] - e0[i], a0[i + 1] - e0[i + 1], a0[i + 2] - e0[i + 2]));
    const va = [(a1[i] - a0[i]) / h, (a1[i + 1] - a0[i + 1]) / h, (a1[i + 2] - a0[i + 2]) / h];
    const ve = [(e0[i] - e1[i]) / h, (e0[i + 1] - e1[i + 1]) / h, (e0[i + 2] - e1[i + 2]) / h];
    vel = Math.max(vel, Math.hypot(va[0] - ve[0], va[1] - ve[1], va[2] - ve[2]));
  }
  return { gap, vel };
}

/**
 * A window's seam before it is spread: the legs' points against the hips at `t1` against where they stand at `t0` (a
 * cycle of two footfalls) or against the mirror of that (`one`), worst gap (m) and the worst of their speeds' (m/s). What
 * the windows were chosen by (tools/swg/tests/stairCycleSearch.ts) and are measured again by.
 */
export function windowSeam(clip: THREE.AnimationClip, skel: TargetSkeleton, t0: number, t1: number, one: boolean): { gap: number; vel: number } {
  const b = bonesOf(skel);
  const legSet = b.names.map((n) => LEG_JOINTS.includes(n));
  const s = new Sampler(clip, b);
  const h = SEAM_DT;
  const pose = newPose(b);
  const mir = newPose(b);
  const P = new Float64Array(b.n * 3);
  const at = (t: number, mirrored: boolean) => {
    s.at(t, pose);
    if (mirrored) mirrorPose(b, pose, pose, false, legSet, mir);
    placesOf(b, mirrored ? mir : pose, P);
    const out: number[] = [];
    const r = b.root * 3;
    for (const n of SEAM_POINTS) {
      const j = b.names.indexOf(n) * 3;
      out.push(P[j] - P[r], P[j + 1] - P[r + 1], P[j + 2] - P[r + 2]);
    }
    return out;
  };
  const a0 = at(t0, one), a1 = at(t0 + h, one), e0 = at(t1, false), e1 = at(t1 - h, false);
  let gap = 0;
  let vel = 0;
  for (let i = 0; i < a0.length; i += 3) {
    gap = Math.max(gap, Math.hypot(a0[i] - e0[i], a0[i + 1] - e0[i + 1], a0[i + 2] - e0[i + 2]));
    const va = [(a1[i] - a0[i]) / h, (a1[i + 1] - a0[i + 1]) / h, (a1[i + 2] - a0[i + 2]) / h];
    const ve = [(e0[i] - e1[i]) / h, (e0[i + 1] - e1[i + 1]) / h, (e0[i + 2] - e1[i + 2]) / h];
    vel = Math.max(vel, Math.hypot(va[0] - ve[0], va[1] - ve[1], va[2] - ve[2]));
  }
  return { gap, vel };
}

/**
 * A clip's own roughness: the worst change of the legs' points' speeds (against the hips) from one of its frames to the
 * next anywhere inside it (its wrap left out), m/s. What a seam's speed is held to: a seam no rougher than the clip's own
 * frames is as smooth as the clip.
 */
export function roughness(clip: THREE.AnimationClip, skel: TargetSkeleton): number {
  const b = bonesOf(skel);
  const s = new Sampler(clip, b);
  const pose = newPose(b);
  const P = new Float64Array(b.n * 3);
  const pts = SEAM_POINTS.map((n) => b.names.indexOf(n));
  const n = Math.max(2, Math.round(clip.duration / SEAM_DT));
  const h = clip.duration / n;
  const rows: number[][] = [];
  for (let i = 0; i <= n; i++) {
    s.at(Math.min(clip.duration, i * h), pose);
    placesOf(b, pose, P);
    const r = b.root * 3;
    rows.push(pts.flatMap((j) => [P[j * 3] - P[r], P[j * 3 + 1] - P[r + 1], P[j * 3 + 2] - P[r + 2]]));
  }
  let worst = 0;
  for (let i = 1; i < n; i++) {
    for (let k = 0; k < rows[i].length; k += 3) {
      const d = [0, 1, 2].map((c) => (rows[i + 1][k + c] - rows[i][k + c] - (rows[i][k + c] - rows[i - 1][k + c])) / h);
      worst = Math.max(worst, Math.hypot(d[0], d[1], d[2]));
    }
  }
  return worst;
}

// ---- once a skeleton ----------------------------------------------------------------------------------------------------

/** What a skeleton's stair cycles are: the clips made, and every stair clip's facts (the cycles' and the clips' as they stand) by clip name. */
export interface StairCycles {
  clips: THREE.AnimationClip[];
  facts: Map<string, StairCycleFacts>;
}

const MADE = new WeakMap<THREE.AnimationClip, StairCycles>();

/**
 * The stair cycles for a skeleton's fitted clips (the pack's, `mx_<id>`), made once and kept by the first stair clip
 * object (shared by every rig of that skeleton). Clips the skeleton cannot make (no legs' joints) are left out; a clip of
 * the pack's not there is left out. Never throws.
 */
export function stairCyclesFor(clips: readonly THREE.AnimationClip[], skel: TargetSkeleton): StairCycles {
  const byName = new Map(clips.map((c) => [c.name, c]));
  const key = clips.find((c) => /^mx_(ascending|running_up|descending)_stairs/.test(c.name)) ?? null;
  if (key) {
    const got = MADE.get(key);
    if (got) return got;
  }
  const out: StairCycles = { clips: [], facts: new Map() };
  try {
    for (const [id, win] of Object.entries(STAIR_WINDOWS)) {
      const clip = byName.get(`mx_${id}`);
      if (!clip) continue;
      const raw = measureCycle(clip, skel, win.one ? 1 : 2);
      if (raw) {
        raw.run = win.run;
        const sm = seamOf(clip, skel);
        raw.seam = sm.gap;
        raw.seamVel = sm.vel;
        out.facts.set(clip.name, raw);
      }
      for (const kind of (win.one ? ['legs', 'whole'] : ['trimmed']) as CycleKind[]) {
        const made = buildCycle(clip, skel, id, kind, win);
        if (!made) continue;
        const facts = measureCycle(made, skel, 2);
        if (!facts) continue;
        facts.run = win.run;
        if (win.one) {
          // A mirrored cycle's two footfalls are the window's own and its mirror, half a cycle apart.
          const one = measureCycle(made, skel, 2);
          if (one) {
            facts.at[0] = one.at[0];
            facts.side[0] = one.side[0];
            facts.off[0] = one.off[0];
            facts.mid[0] = one.mid[0];
            facts.at[1] = (one.at[0] + made.duration / 2) % made.duration;
            facts.side[1] = 1 - one.side[0];
            facts.off[1] = one.off[0];
            facts.mid[1] = one.mid[0];
          }
        }
        const sm = seamOf(made, skel);
        facts.seam = sm.gap;
        facts.seamVel = sm.vel;
        out.clips.push(made);
        out.facts.set(made.name, facts);
      }
    }
  } catch (err) {
    console.warn('stair cycles: not made', err);
  }
  if (key) MADE.set(key, out);
  return out;
}
