// The fitter: a pack clip (src/anim/mxaFile.ts) put on a target skeleton.
//
// A pack clip is each source bone's world turn away from its own rest pose, `D`, and the hips' travel. For a target
// joint `j` driven by source bone `b`, at every frame:
//
//   W_j = G * D_b * G^-1 * A_b^-1 * R0_j
//
// `R0_j` is the joint's rest world rotation, `G` the yaw that lays the source's left-right hip line on the target's,
// and `A_b` the rest alignment: the shortest turn from the source's rest bone direction to the target's, taken only
// for the limbs (`mixamoMap.ts` says which and why; identity for the hips, the spine, the neck, the head, the
// clavicles, the feet and the toes). A limb's last joint (a finger's end, on a skeleton whose fingers end there) has
// no line of its own to be lined up along and takes its parent bone's alignment, so it rides its parent as the
// source's rides its own. The joint's local rotation is its parent's fitted world, inverted, times `W_j`; a joint the
// map does not name keeps its rest under whatever its parent does.
//
// The root's place is its rest plus the hips' travel, scaled by the two skeletons' leg heights and turned by `G`, with
// the level part of the travel stripped so that no clip moves the body: an animation never moves the character without
// the player's say. Between a clip's trim and its end the net level travel is taken out as a straight ramp, and before
// the trim the hips are held in place. Where they are held is the clip's anchor: a loop's is where its own first frame
// has them (an in-place cycle's hips sway about the source's origin, and that is its pose), and a one-off's is level
// over their rest place, the middle of the body the game moves, since a one-off's first frame is wherever the take
// happened to begin (the jump's start is authored a tenth of a metre to one side, feet and all) and, trimmed, is a
// frame nobody sees. Height is kept as authored, less a clip's `level` where the importer gave it one.
//
// Pure: arrays in and arrays out, no three.js, so the node tests fit a skeleton they made themselves.

import { frameTime, type ClipData, type PackBone } from './mxaFile.ts';
import { ALIGN_GROUP, SOURCE_CHILD, SOURCE_TO_JOINT, aligns, type AlignFlags } from './mixamoMap.ts';

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

/** One joint of a target skeleton at its bind pose: its parent in the list (before it), and its rest under that parent. */
export interface TargetJoint {
  name: string;
  /** Index of its parent joint, -1 for a joint that hangs from no joint. */
  parent: number;
  restP: Vec3;
  restQ: Quat;
}

/** A target skeleton: its joints parent first, and where a parentless joint's own parent stands in the figure's frame (Y up). */
export interface TargetSkeleton {
  joints: TargetJoint[];
  base: { p: Vec3; q: Quat };
  /**
   * Where the game's own clips hold the joint that takes the travel, as an offset from its rest place in its parent's
   * frame (the standing idle's first frame less the bind pose; a species' own clips all stand in one place, which
   * is not the bind pose's: 5.5 cm ahead of it on the human). The fitted clips are anchored there, level, so a
   * hand-over between one of the game's clips and an imported one does not slide the hips. Absent: the bind pose's.
   */
  anchor?: Vec3;
}

/** What a fit says of a skeleton. */
export interface FitReport {
  /** Joints the map drives on this skeleton. */
  mapped: number;
  /** Joints the map names that this skeleton has not got. */
  missing: string[];
  /** Joints of this skeleton nothing drives (they keep their rest). */
  rest: string[];
  /** The yaw that lays the source's hip line on the target's, degrees. */
  facing: number;
  /** How well the two skeletons' toes then point the same way: 1 the same, -1 opposite. Under 0.7 the facing is in doubt. */
  toes: number;
  /** The target's hips-to-ankle rest height over the source's: what the hips' travel is scaled by. */
  scale: number;
  /** For the standing rest (the source in its own rest pose), how far each ankle ends over (+) or under (-) where it rests, metres. */
  feet: { left: number; right: number };
  /** For the standing rest, how far the hips are turned from their own rest, degrees: 0 unless the torso is lined up. */
  hipsTilt: number;
  /** The same for the worst joint of the spine, neck and head. */
  spineTilt: number;
  align: AlignFlags;
}

/** Everything about one skeleton's fit that does not change from clip to clip. */
export interface FitPlan {
  joints: readonly TargetJoint[];
  /** For each joint, the source bone that drives it, or -1. */
  boneOf: Int32Array;
  /** joints * 4: for a driven joint `A^-1 * R0`, for any other its rest local rotation. */
  tail: Float64Array;
  /** joints * 4 and joints * 3: every joint's rest in the figure's frame. */
  restWorldQ: Float64Array;
  restWorldP: Float64Array;
  baseQ: Quat;
  /** The yaw `G`, as its cosine and sine. */
  cos: number;
  sin: number;
  scale: number;
  /** The joint the hips drive (the one that takes the travel), or -1. */
  root: number;
  /** The driven joints, in the skeleton's order: one rotation track each. */
  driven: number[];
  /** Where the clips are anchored, less the root's rest place, in the root's parent's frame, level (no height): nought without an anchor. */
  anchor: Vec3;
  report: FitReport;
}

/** A clip fitted: one rotation track a driven joint and the root's place, frame by frame. */
export interface FittedClip {
  frames: number;
  duration: number;
  times: Float32Array;
  /** The driven joints' names, one a track. */
  joints: string[];
  /** One array a driven joint, frames * 4 (x, y, z, w), local to its parent. */
  rotations: Float32Array[];
  /** The joint that takes the travel, or '' with none. */
  rootJoint: string;
  /** frames * 3, local to that joint's parent. */
  rootPosition: Float32Array;
  /** The furthest the hips stray level from where the clip is anchored, target metres: how far a body's middle leaves its capsule. */
  strays: number;
}

// ---- quaternions on plain arrays -------------------------------------------------------------------------------------

function mulInto(out: Float64Array | number[], o: number, a: ArrayLike<number>, ai: number, b: ArrayLike<number>, bi: number): void {
  const ax = a[ai], ay = a[ai + 1], az = a[ai + 2], aw = a[ai + 3];
  const bx = b[bi], by = b[bi + 1], bz = b[bi + 2], bw = b[bi + 3];
  out[o] = ax * bw + aw * bx + ay * bz - az * by;
  out[o + 1] = ay * bw + aw * by + az * bx - ax * bz;
  out[o + 2] = az * bw + aw * bz + ax * by - ay * bx;
  out[o + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

/** conj(a) * b. */
function mulConjInto(out: Float64Array | Float32Array | number[], o: number, a: ArrayLike<number>, ai: number, b: ArrayLike<number>, bi: number): void {
  const ax = -a[ai], ay = -a[ai + 1], az = -a[ai + 2], aw = a[ai + 3];
  const bx = b[bi], by = b[bi + 1], bz = b[bi + 2], bw = b[bi + 3];
  out[o] = ax * bw + aw * bx + ay * bz - az * by;
  out[o + 1] = ay * bw + aw * by + az * bx - ax * bz;
  out[o + 2] = az * bw + aw * bz + ax * by - ay * bx;
  out[o + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

function rotateInto(out: Float64Array | number[], o: number, q: ArrayLike<number>, qi: number, x: number, y: number, z: number): void {
  const qx = q[qi], qy = q[qi + 1], qz = q[qi + 2], qw = q[qi + 3];
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  out[o] = x + qw * tx + (qy * tz - qz * ty);
  out[o + 1] = y + qw * ty + (qz * tx - qx * tz);
  out[o + 2] = z + qw * tz + (qx * ty - qy * tx);
}

/** The shortest turn taking one unit vector onto another. */
function betweenUnit(ax: number, ay: number, az: number, bx: number, by: number, bz: number): Quat {
  let r = ax * bx + ay * by + az * bz + 1;
  let x: number, y: number, z: number;
  if (r < 1e-9) {
    // Opposite: half a turn about any axis square to the first.
    r = 0;
    if (Math.abs(ax) > Math.abs(az)) {
      x = -ay;
      y = ax;
      z = 0;
    } else {
      x = 0;
      y = -az;
      z = ay;
    }
  } else {
    x = ay * bz - az * by;
    y = az * bx - ax * bz;
    z = ax * by - ay * bx;
  }
  const n = Math.hypot(x, y, z, r) || 1;
  return [x / n, y / n, z / n, r / n];
}

/**
 * The angle a quaternion turns by, degrees. By the arctangent of its two parts, never an arccosine of its last: next
 * to nought that loses half its digits, and a joint left exactly at rest read as turned a few hundred-thousandths of
 * a degree.
 */
function angleOf(q: ArrayLike<number>, i = 0): number {
  return (2 * Math.atan2(Math.hypot(q[i], q[i + 1], q[i + 2]), Math.abs(q[i + 3])) * 180) / Math.PI;
}

/** Every joint's rest in the figure's frame: `q` (joints * 4) and `p` (joints * 3). */
export function restWorld(target: TargetSkeleton): { q: Float64Array; p: Float64Array } {
  const n = target.joints.length;
  const q = new Float64Array(n * 4);
  const p = new Float64Array(n * 3);
  for (let j = 0; j < n; j++) {
    const joint = target.joints[j];
    if (joint.parent >= j) throw new Error(`${joint.name} is listed before its parent`);
    if (joint.parent < 0) {
      mulInto(q, j * 4, target.base.q, 0, joint.restQ, 0);
      rotateInto(p, j * 3, target.base.q, 0, joint.restP[0], joint.restP[1], joint.restP[2]);
      p[j * 3] += target.base.p[0];
      p[j * 3 + 1] += target.base.p[1];
      p[j * 3 + 2] += target.base.p[2];
    } else {
      const k = joint.parent;
      mulInto(q, j * 4, q, k * 4, joint.restQ, 0);
      rotateInto(p, j * 3, q, k * 4, joint.restP[0], joint.restP[1], joint.restP[2]);
      p[j * 3] += p[k * 3];
      p[j * 3 + 1] += p[k * 3 + 1];
      p[j * 3 + 2] += p[k * 3 + 2];
    }
  }
  return { q, p };
}

/**
 * Work a skeleton's fit out: the facing, each driven joint's constant, the scale and the report. `flags` says which
 * groups beside the limbs have their rests lined up (none, as shipped).
 */
export function planFit(bones: readonly PackBone[], target: TargetSkeleton, flags: AlignFlags): FitPlan {
  const joints = target.joints;
  const n = joints.length;
  const world = restWorld(target);
  const jointAt = new Map<string, number>();
  joints.forEach((j, i) => { if (!jointAt.has(j.name)) jointAt.set(j.name, i); });
  const boneAt = new Map(bones.map((b, i) => [b.name, i]));

  // Facing: the yaw that turns the source's left-right hip line onto the target's.
  let yaw = 0;
  const sl = boneAt.get('LeftUpLeg'), sr = boneAt.get('RightUpLeg'), tl = jointAt.get(SOURCE_TO_JOINT.LeftUpLeg), tr = jointAt.get(SOURCE_TO_JOINT.RightUpLeg);
  if (sl !== undefined && sr !== undefined && tl !== undefined && tr !== undefined) {
    const sx = bones[sl].rest[0] - bones[sr].rest[0], sz = bones[sl].rest[2] - bones[sr].rest[2];
    const tx = world.p[tl * 3] - world.p[tr * 3], tz = world.p[tl * 3 + 2] - world.p[tr * 3 + 2];
    if (Math.hypot(sx, sz) > 1e-6 && Math.hypot(tx, tz) > 1e-6) yaw = Math.atan2(tx, tz) - Math.atan2(sx, sz);
  }
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  // A source vector in the figure's frame: turned about the vertical by the facing.
  const turnX = (x: number, z: number) => x * cos + z * sin;
  const turnZ = (x: number, z: number) => -x * sin + z * cos;

  const boneOf = new Int32Array(n).fill(-1);
  const tail = new Float64Array(n * 4);
  const missing: string[] = [];
  const driven: number[] = [];
  for (let j = 0; j < n; j++) tail.set(joints[j].restQ, j * 4);
  // The alignment each lined-up bone took, by its place in the pack's list (parent first, so a bone's parent is there before it).
  const alignOf = new Map<number, Quat>();
  for (const [b, bone] of bones.entries()) {
    const jn = SOURCE_TO_JOINT[bone.name];
    if (!jn) continue;
    const j = jointAt.get(jn);
    if (j === undefined) {
      missing.push(jn);
      continue;
    }
    boneOf[j] = b;
    // The rest alignment, for a bone that takes one.
    let a: Quat = [0, 0, 0, 1];
    if (aligns(bone.name, flags)) {
      const childName = SOURCE_CHILD[bone.name];
      const cb = childName !== undefined ? boneAt.get(childName) : undefined;
      const cj = childName !== undefined ? jointAt.get(SOURCE_TO_JOINT[childName]) : undefined;
      if (cb !== undefined && cj !== undefined) {
        // Along its next joint, on both skeletons.
        const rx = bones[cb].rest[0] - bone.rest[0], ry = bones[cb].rest[1] - bone.rest[1], rz = bones[cb].rest[2] - bone.rest[2];
        const dsx = turnX(rx, rz), dsy = ry, dsz = turnZ(rx, rz);
        const dtx = world.p[cj * 3] - world.p[j * 3], dty = world.p[cj * 3 + 1] - world.p[j * 3 + 1], dtz = world.p[cj * 3 + 2] - world.p[j * 3 + 2];
        const ls = Math.hypot(dsx, dsy, dsz), lt = Math.hypot(dtx, dty, dtz);
        if (ls > 1e-6 && lt > 1e-6) a = betweenUnit(dsx / ls, dsy / ls, dsz / ls, dtx / lt, dty / lt, dtz / lt);
      } else if (ALIGN_GROUP[bone.name] === 'limbs') {
        // A limb's last joint (a finger's end: the game's fingers stop at their second joint) has no next joint to be
        // lined up along. It takes its parent bone's alignment, so with the source at rest it keeps its own rest under
        // its parent: left unaligned under a parent that was, it stood bent by the whole of the parent's alignment
        // (40 to 62 degrees at every fingertip, in every clip).
        a = alignOf.get(bone.parent) ?? a;
      }
      alignOf.set(b, a);
    }
    // A^-1 * R0
    mulConjInto(tail, j * 4, a, 0, world.q, j * 4);
  }
  for (let j = 0; j < n; j++) if (boneOf[j] >= 0) driven.push(j);

  // The scale: the legs' rest heights, hips down to ankles.
  const hips = boneAt.get('Hips') ?? 0;
  const root = jointAt.get(SOURCE_TO_JOINT[bones[hips].name] ?? '') ?? -1;
  const legHeight = (top: number, at: (i: number) => number, ...ankles: (number | undefined)[]) => {
    const found = ankles.filter((a): a is number => a !== undefined);
    return found.length ? top - found.reduce((s, a) => s + at(a), 0) / found.length : top;
  };
  const srcLeg = legHeight(bones[hips].rest[1], (i) => bones[i].rest[1], boneAt.get('LeftFoot'), boneAt.get('RightFoot'));
  const tgtLeg = root >= 0 ? legHeight(world.p[root * 3 + 1], (i) => world.p[i * 3 + 1], jointAt.get(SOURCE_TO_JOINT.LeftFoot), jointAt.get(SOURCE_TO_JOINT.RightFoot)) : 0;
  const scale = srcLeg > 1e-6 && tgtLeg > 1e-6 ? tgtLeg / srcLeg : 1;

  // How well the facing holds: the toes' directions, source against target.
  let toes = 1;
  const sa = boneAt.get('LeftFoot'), st = boneAt.get('LeftToeBase'), ta = jointAt.get(SOURCE_TO_JOINT.LeftFoot), tt = jointAt.get(SOURCE_TO_JOINT.LeftToeBase);
  if (sa !== undefined && st !== undefined && ta !== undefined && tt !== undefined) {
    const rx = bones[st].rest[0] - bones[sa].rest[0], rz = bones[st].rest[2] - bones[sa].rest[2];
    const fx = turnX(rx, rz), fz = turnZ(rx, rz);
    const gx = world.p[tt * 3] - world.p[ta * 3], gz = world.p[tt * 3 + 2] - world.p[ta * 3 + 2];
    const lf = Math.hypot(fx, fz), lg = Math.hypot(gx, gz);
    if (lf > 1e-6 && lg > 1e-6) toes = (fx * gx + fz * gz) / (lf * lg);
  }

  // The standing rest: the source in its own rest pose (every delta nothing), posed on the target.
  const standQ = new Float64Array(n * 4);
  const standP = new Float64Array(n * 3);
  for (let j = 0; j < n; j++) {
    const k = joints[j].parent;
    if (boneOf[j] >= 0) standQ.set(tail.subarray(j * 4, j * 4 + 4), j * 4);
    else if (k < 0) mulInto(standQ, j * 4, target.base.q, 0, joints[j].restQ, 0);
    else mulInto(standQ, j * 4, standQ, k * 4, joints[j].restQ, 0);
    if (k < 0) standP.set(world.p.subarray(j * 3, j * 3 + 3), j * 3);
    else {
      rotateInto(standP, j * 3, standQ, k * 4, joints[j].restP[0], joints[j].restP[1], joints[j].restP[2]);
      standP[j * 3] += standP[k * 3];
      standP[j * 3 + 1] += standP[k * 3 + 1];
      standP[j * 3 + 2] += standP[k * 3 + 2];
    }
  }
  const tiltOf = (j: number) => {
    const d: Quat = [0, 0, 0, 1];
    mulConjInto(d, 0, world.q, j * 4, standQ, j * 4);
    return angleOf(d);
  };
  const drop = (name: string) => {
    const j = jointAt.get(name);
    return j === undefined ? 0 : standP[j * 3 + 1] - world.p[j * 3 + 1];
  };
  let spineTilt = 0;
  for (const [bone, group] of Object.entries(ALIGN_GROUP)) {
    if (group !== 'torso' || bone === 'Hips') continue;
    const j = jointAt.get(SOURCE_TO_JOINT[bone]);
    if (j !== undefined && boneOf[j] >= 0) spineTilt = Math.max(spineTilt, tiltOf(j));
  }
  const report: FitReport = {
    mapped: driven.length,
    missing,
    rest: joints.filter((_, j) => boneOf[j] < 0).map((j) => j.name),
    facing: (yaw * 180) / Math.PI,
    toes,
    scale,
    feet: { left: drop(SOURCE_TO_JOINT.LeftFoot), right: drop(SOURCE_TO_JOINT.RightFoot) },
    hipsTilt: root >= 0 ? tiltOf(root) : 0,
    spineTilt,
    align: { torso: flags.torso, feet: flags.feet, clavicles: flags.clavicles },
  };
  // The anchor: the offset the game's own clips hold the root at, turned into the figure's frame, its height taken out
  // (a clip's height is its own, as authored), and turned back into the root's parent's frame, where the track is written.
  const anchor: Vec3 = [0, 0, 0];
  if (target.anchor && root >= 0) {
    const rk = joints[root].parent;
    const pq = rk < 0 ? [target.base.q[0], target.base.q[1], target.base.q[2], target.base.q[3]] : [world.q[rk * 4], world.q[rk * 4 + 1], world.q[rk * 4 + 2], world.q[rk * 4 + 3]];
    const level = [0, 0, 0];
    rotateInto(level, 0, pq, 0, target.anchor[0], target.anchor[1], target.anchor[2]);
    rotateInto(anchor, 0, [-pq[0], -pq[1], -pq[2], pq[3]], 0, level[0], 0, level[2]);
  }
  return { joints, boneOf, tail, restWorldQ: world.q, restWorldP: world.p, baseQ: [target.base.q[0], target.base.q[1], target.base.q[2], target.base.q[3]], cos, sin, scale, root, driven, anchor, report };
}

/** What a clip's index row tells the fitter. */
export interface FitRow {
  /** Where the game starts it, seconds: the travel's strip is anchored there. */
  trimStart: number;
  /**
   * Whether it is played round. A loop keeps its hips where its own first frame has them; a one-off begins (at its
   * trim) and ends with them level over their rest place.
   */
  loop: boolean;
  /** A height taken off the hips' travel, source metres (an airborne loop authored off the ground). */
  level?: number;
}

/** The hips' level travel at a time, blended between frames. */
function levelAt(clip: ClipData, t: number, k: 0 | 2): number {
  const last = clip.frames - 1;
  if (last < 1 || !(clip.duration > 0)) return clip.travel[k];
  const x = Math.min(last, Math.max(0, (t / clip.duration) * last));
  const i = Math.min(last - 1, Math.floor(x));
  return clip.travel[i * 3 + k] + (clip.travel[(i + 1) * 3 + k] - clip.travel[i * 3 + k]) * (x - i);
}

/**
 * Fit one clip. With `into` (a clip this plan's skeleton was fitted with before, of the same frames), the arrays are
 * written in place: what plays them reads the new values at its next frame, and nothing is made.
 */
export function fitClip(plan: FitPlan, clip: ClipData, row: FitRow, into?: FittedClip): FittedClip {
  const { joints, boneOf, tail, driven } = plan;
  const n = joints.length;
  const frames = clip.frames;
  const same = into !== undefined && into.frames === frames && into.rotations.length === driven.length;
  const out: FittedClip = same
    ? into
    : {
        frames,
        duration: clip.duration,
        times: new Float32Array(frames),
        joints: driven.map((j) => joints[j].name),
        rotations: driven.map(() => new Float32Array(frames * 4)),
        rootJoint: plan.root >= 0 ? joints[plan.root].name : '',
        rootPosition: new Float32Array(frames * 3),
        strays: 0,
      };
  out.duration = clip.duration;
  const slot = new Int32Array(n).fill(-1);
  driven.forEach((j, i) => { slot[j] = i; });
  const world = new Float64Array(n * 4);
  const turned = [0, 0, 0, 1];
  const v = [0, 0, 0];
  const { cos, sin, scale, root } = plan;

  // The strip: where the hips are anchored (a loop: where its first frame has them; a one-off: over their rest place),
  // and the level travel at the trim and at the end.
  const T = clip.duration;
  const t0 = Math.min(Math.max(0, row.trimStart), T);
  const x0 = row.loop ? clip.travel[0] : 0, z0 = row.loop ? clip.travel[2] : 0;
  const xa = levelAt(clip, t0, 0), za = levelAt(clip, t0, 2);
  const xT = clip.travel[(frames - 1) * 3], zT = clip.travel[(frames - 1) * 3 + 2];
  const lift = row.level ?? 0;
  let strays = 0;
  // The root's parent's rest turn, inverted (the figure's base for a root that hangs from no joint).
  const rk = root >= 0 ? joints[root].parent : -1;
  const rootParentInv = rk < 0 ? [-plan.baseQ[0], -plan.baseQ[1], -plan.baseQ[2], plan.baseQ[3]] : [-plan.restWorldQ[rk * 4], -plan.restWorldQ[rk * 4 + 1], -plan.restWorldQ[rk * 4 + 2], plan.restWorldQ[rk * 4 + 3]];

  for (let f = 0; f < frames; f++) {
    const t = frameTime(f, frames, T);
    out.times[f] = t;
    for (let j = 0; j < n; j++) {
      const k = joints[j].parent;
      const b = boneOf[j];
      if (b < 0) {
        // Nothing drives it: its rest, under whatever its parent has done.
        if (k < 0) mulInto(world, j * 4, plan.baseQ, 0, tail, j * 4);
        else mulInto(world, j * 4, world, k * 4, tail, j * 4);
        continue;
      }
      // G * D * G^-1: the same turn about an axis turned by the facing.
      const d = (f * clip.bones + b) * 4;
      const dx = clip.quats[d], dz = clip.quats[d + 2];
      turned[0] = dx * cos + dz * sin;
      turned[1] = clip.quats[d + 1];
      turned[2] = -dx * sin + dz * cos;
      turned[3] = clip.quats[d + 3];
      mulInto(world, j * 4, turned, 0, tail, j * 4);
      const values = out.rotations[slot[j]];
      if (k < 0) mulConjInto(values, f * 4, plan.baseQ, 0, world, j * 4);
      else mulConjInto(values, f * 4, world, k * 4, world, j * 4);
      // One sign down each joint's frames, and unit.
      const o = f * 4;
      let qx = values[o], qy = values[o + 1], qz = values[o + 2], qw = values[o + 3];
      const len = Math.hypot(qx, qy, qz, qw) || 1;
      const flip = f > 0 && values[o - 4] * qx + values[o - 3] * qy + values[o - 2] * qz + values[o - 1] * qw < 0 ? -1 : 1;
      qx = (qx / len) * flip;
      qy = (qy / len) * flip;
      qz = (qz / len) * flip;
      qw = (qw / len) * flip;
      values[o] = qx;
      values[o + 1] = qy;
      values[o + 2] = qz;
      values[o + 3] = qw;
    }
    if (root >= 0) {
      // The hips' travel less the strip: held at the anchor until the trim, and from there the net level travel taken
      // out as a straight ramp, so the clip ends where it began.
      const hx = clip.travel[f * 3], hz = clip.travel[f * 3 + 2];
      let ox = x0, oz = z0;
      if (t > t0 && T > t0) {
        const u = (t - t0) / (T - t0);
        ox = hx - (xa - x0) - (xT - xa) * u;
        oz = hz - (za - z0) - (zT - za) * u;
      }
      strays = Math.max(strays, Math.hypot(ox - x0, oz - z0) * scale);
      const oy = clip.travel[f * 3 + 1] - lift;
      // How far the root stands from its rest in the figure's frame: the travel scaled and turned by the facing...
      const wx = scale * (ox * cos + oz * sin);
      const wy = scale * oy;
      const wz = scale * (-ox * sin + oz * cos);
      // ...and that in the frame of the root's parent, which nothing moves: its rest place plus the offset turned back.
      rotateInto(v, 0, rootParentInv, 0, wx, wy, wz);
      // ...from where the clips are anchored: the rest place, or level with where the game's own clips stand (`anchor`).
      out.rootPosition[f * 3] = joints[root].restP[0] + plan.anchor[0] + v[0];
      out.rootPosition[f * 3 + 1] = joints[root].restP[1] + plan.anchor[1] + v[1];
      out.rootPosition[f * 3 + 2] = joints[root].restP[2] + plan.anchor[2] + v[2];
    }
  }
  out.strays = strays;
  return out;
}

/**
 * Where a fitted frame puts every joint, in the figure's frame: `q` (joints * 4) and `p` (joints * 3). For the tests
 * and the report; the game plays the tracks and never calls this.
 */
export function poseAt(plan: FitPlan, base: { p: Vec3; q: Quat }, fitted: FittedClip, frame: number): { q: Float64Array; p: Float64Array } {
  const joints = plan.joints;
  const n = joints.length;
  const q = new Float64Array(n * 4);
  const p = new Float64Array(n * 3);
  const slot = new Map(fitted.joints.map((name, i) => [name, i]));
  const local = [0, 0, 0, 1];
  for (let j = 0; j < n; j++) {
    const joint = joints[j];
    const s = slot.get(joint.name);
    if (s !== undefined) for (let c = 0; c < 4; c++) local[c] = fitted.rotations[s][frame * 4 + c];
    else for (let c = 0; c < 4; c++) local[c] = joint.restQ[c];
    const at = joint.name === fitted.rootJoint ? [fitted.rootPosition[frame * 3], fitted.rootPosition[frame * 3 + 1], fitted.rootPosition[frame * 3 + 2]] : joint.restP;
    if (joint.parent < 0) {
      mulInto(q, j * 4, base.q, 0, local, 0);
      rotateInto(p, j * 3, base.q, 0, at[0], at[1], at[2]);
      p[j * 3] += base.p[0];
      p[j * 3 + 1] += base.p[1];
      p[j * 3 + 2] += base.p[2];
    } else {
      const k = joint.parent;
      mulInto(q, j * 4, q, k * 4, local, 0);
      rotateInto(p, j * 3, q, k * 4, at[0], at[1], at[2]);
      p[j * 3] += p[k * 3];
      p[j * 3 + 1] += p[k * 3 + 1];
      p[j * 3 + 2] += p[k * 3 + 2];
    }
  }
  return { q, p };
}

/** A skeleton's own key: two skeletons with one key take one fit. Names, parents and rests, to a hundredth of a millimetre. */
export function skeletonKey(target: TargetSkeleton): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  const eat = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h1 = Math.imul(h1 ^ s.charCodeAt(i), 0x01000193) >>> 0;
      h2 = Math.imul(h2 + s.charCodeAt(i), 0x85ebca6b) >>> 0;
      h2 = (h2 ^ (h2 >>> 13)) >>> 0;
    }
  };
  const num = (v: number) => (Math.round(v * 1e5) + 0).toString(36);
  for (const j of target.joints) eat(`${j.name}|${j.parent}|${j.restP.map(num).join(',')}|${j.restQ.map(num).join(',')};`);
  eat(`${target.base.p.map(num).join(',')}|${target.base.q.map(num).join(',')}`);
  // Only a skeleton that says where its own clips stand: one that does not keeps the key it always had.
  if (target.anchor) eat(`|anchor:${target.anchor.map(num).join(',')}`);
  return `${target.joints.length}-${h1.toString(36)}${h2.toString(36)}`;
}
