// What the imported animations' tests are run on: a source skeleton and a target skeleton made here (never a file of
// the game's or of the importer's source), clips made by rule, a converted body's skeleton read from its GLB where the
// packs are on disk, and the few quaternion helpers the checks need.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ClipData, PackBone } from '../../../src/anim/mxaFile.ts';
import type { Quat, TargetJoint, TargetSkeleton, Vec3 } from '../../../src/anim/fit.ts';

export const DEG = Math.PI / 180;

export function qmul(a: ArrayLike<number>, b: ArrayLike<number>): Quat {
  const [ax, ay, az, aw] = [a[0], a[1], a[2], a[3]];
  const [bx, by, bz, bw] = [b[0], b[1], b[2], b[3]];
  return [ax * bw + aw * bx + ay * bz - az * by, ay * bw + aw * by + az * bx - ax * bz, az * bw + aw * bz + ax * by - ay * bx, aw * bw - ax * bx - ay * by - az * bz];
}
export const qconj = (q: ArrayLike<number>): Quat => [-q[0], -q[1], -q[2], q[3]];
export function qaxis(x: number, y: number, z: number, angle: number): Quat {
  const n = Math.hypot(x, y, z) || 1;
  const s = Math.sin(angle / 2);
  return [(x / n) * s, (y / n) * s, (z / n) * s, Math.cos(angle / 2)];
}
export function qrot(q: ArrayLike<number>, v: ArrayLike<number>): Vec3 {
  const [x, y, z] = [v[0], v[1], v[2]];
  const [qx, qy, qz, qw] = [q[0], q[1], q[2], q[3]];
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  return [x + qw * tx + (qy * tz - qz * ty), y + qw * ty + (qz * tx - qx * tz), z + qw * tz + (qx * ty - qy * tx)];
}
/**
 * The angle between two rotations, degrees. By the turn from one to the other and the arctangent of its two parts,
 * never an arccosine of a dot product: next to nought that loses half its digits, and reads two rotations a few
 * thousandths of a degree apart as hundredths.
 */
export function qangle(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const r = qmul(qconj(a), b);
  return (2 * Math.atan2(Math.hypot(r[0], r[1], r[2]), Math.abs(r[3]))) / DEG;
}
export const at4 = (a: ArrayLike<number>, i: number): Quat => [a[i * 4], a[i * 4 + 1], a[i * 4 + 2], a[i * 4 + 3]];
export const at3 = (a: ArrayLike<number>, i: number): Vec3 => [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]];

/**
 * A source skeleton in the source's own terms: a figure in a T pose, Y up, facing +Z, left +X, hips a metre up.
 * `[name, parent, x, y, z]`, world rest places in metres.
 */
const SOURCE: [string, string | null, number, number, number][] = [
  ['Hips', null, 0, 1.0, 0],
  ['LeftUpLeg', 'Hips', 0.09, 0.93, 0],
  ['LeftLeg', 'LeftUpLeg', 0.09, 0.5, 0],
  ['LeftFoot', 'LeftLeg', 0.09, 0.08, -0.03],
  ['LeftToeBase', 'LeftFoot', 0.09, 0.0, 0.1],
  ['RightUpLeg', 'Hips', -0.09, 0.93, 0],
  ['RightLeg', 'RightUpLeg', -0.09, 0.5, 0],
  ['RightFoot', 'RightLeg', -0.09, 0.08, -0.03],
  ['RightToeBase', 'RightFoot', -0.09, 0.0, 0.1],
  ['Spine', 'Hips', 0, 1.1, 0],
  ['Spine1', 'Spine', 0, 1.2, 0],
  ['Spine2', 'Spine1', 0, 1.3, 0],
  ['LeftShoulder', 'Spine2', 0.06, 1.42, 0],
  ['LeftArm', 'LeftShoulder', 0.18, 1.42, 0],
  ['LeftForeArm', 'LeftArm', 0.45, 1.42, 0],
  ['LeftHand', 'LeftForeArm', 0.7, 1.42, 0],
  ['LeftHandIndex1', 'LeftHand', 0.79, 1.42, 0],
  ['Neck', 'Spine2', 0, 1.47, 0],
  ['Head', 'Neck', 0, 1.56, 0.01],
  ['RightShoulder', 'Spine2', -0.06, 1.42, 0],
  ['RightArm', 'RightShoulder', -0.18, 1.42, 0],
  ['RightForeArm', 'RightArm', -0.45, 1.42, 0],
  ['RightHand', 'RightForeArm', -0.7, 1.42, 0],
  ['RightHandIndex1', 'RightHand', -0.79, 1.42, 0],
];

/** The index finger's second joint a side, for the checks of a limb's last joint (`fingers`). */
const SOURCE_FINGERS: [string, string | null, number, number, number][] = [
  ['LeftHandIndex2', 'LeftHandIndex1', 0.83, 1.42, 0],
  ['RightHandIndex2', 'RightHandIndex1', -0.83, 1.42, 0],
];

export function sourceBones({ fingers = false }: { fingers?: boolean } = {}): PackBone[] {
  const rows = fingers ? [...SOURCE, ...SOURCE_FINGERS] : SOURCE;
  const at = new Map(rows.map((r, i) => [r[0], i]));
  return rows.map(([name, parent, x, y, z]) => ({ name, parent: parent === null ? -1 : at.get(parent)!, rest: [x, y, z] }));
}

/**
 * A target skeleton in the game's joint names, built from world rest places: every joint is given a rest rotation of
 * its own (a different turn for each, so nothing here passes by its frames happening to be the world's), and its
 * local rest is worked out from the two.
 *
 * `lean` leans the root-to-spine1 line forward by that many degrees, as the game's does; `arms` drops the arms that
 * far below level (the game's rest is no T pose); `yaw` turns the whole figure about the vertical; `height` scales it;
 * `fingers` gives each index finger its second joint, where the game's fingers end.
 */
export function targetSkeleton({ lean = 33, arms = 40, yaw = 0, height = 1, ulna = true, toes = true, twist = true, fingers = false }: { lean?: number; arms?: number; yaw?: number; height?: number; ulna?: boolean; toes?: boolean; twist?: boolean; fingers?: boolean } = {}): TargetSkeleton {
  const s1 = [0, 1.0 + 0.07 * Math.cos(lean * DEG), 0.07 * Math.sin(lean * DEG)];
  const arm = (side: number, reach: number): [number, number, number] => [side * (0.17 + reach * Math.cos(arms * DEG)), 1.43 - reach * Math.sin(arms * DEG), 0];
  const rows: [string, string | null, number, number, number][] = [
    ['root', null, 0, 1.0, 0],
    ['spine1', 'root', s1[0], s1[1], s1[2]],
    ['spine2', 'spine1', 0, 1.18, 0.02],
    ['spine3', 'spine2', 0, 1.3, 0.0],
    ['neck', 'spine3', 0, 1.5, -0.01],
    ['Head', 'neck', 0, 1.58, 0.01],
    ['face_root', 'Head', 0, 1.6, 0.05],
    ['lClav', 'spine3', 0.05, 1.4, 0.01],
    ['lArm', 'lClav', ...arm(1, 0)],
    ['lForeArm', 'lArm', ...arm(1, 0.27)],
    ...(ulna ? ([['lUlna', 'lForeArm', ...arm(1, 0.4)]] as [string, string, number, number, number][]) : []),
    ['lWrist', ulna ? 'lUlna' : 'lForeArm', ...arm(1, 0.52)],
    ['lIndex01', 'lWrist', ...arm(1, 0.61)],
    ...(fingers ? ([['lIndex02', 'lIndex01', ...arm(1, 0.65)]] as [string, string, number, number, number][]) : []),
    ['hold_l', 'lWrist', ...arm(1, 0.58)],
    ['rClav', 'spine3', -0.05, 1.4, 0.01],
    ['rArm', 'rClav', ...arm(-1, 0)],
    ['rForeArm', 'rArm', ...arm(-1, 0.27)],
    ...(ulna ? ([['rUlna', 'rForeArm', ...arm(-1, 0.4)]] as [string, string, number, number, number][]) : []),
    ['rWrist', ulna ? 'rUlna' : 'rForeArm', ...arm(-1, 0.52)],
    ['rIndex01', 'rWrist', ...arm(-1, 0.61)],
    ...(fingers ? ([['rIndex02', 'rIndex01', ...arm(-1, 0.65)]] as [string, string, number, number, number][]) : []),
    ['lThigh', 'root', 0.1, 0.96, 0.03],
    ['lShin', 'lThigh', 0.1, 0.52, 0.035],
    ['lAnkle', 'lShin', 0.1, 0.07, -0.02],
    ...(toes ? ([['lToe', 'lAnkle', 0.1, 0.0, 0.11]] as [string, string, number, number, number][]) : []),
    ['rThigh', 'root', -0.1, 0.96, 0.03],
    ['rShin', 'rThigh', -0.1, 0.52, 0.035],
    ['rAnkle', 'rShin', -0.1, 0.07, -0.02],
    ...(toes ? ([['rToe', 'rAnkle', -0.1, 0.0, 0.11]] as [string, string, number, number, number][]) : []),
  ];
  const turn = qaxis(0, 1, 0, yaw * DEG);
  const at = new Map(rows.map((r, i) => [r[0], i]));
  const worldP: Vec3[] = rows.map(([, , x, y, z]) => qrot(turn, [x * height, y * height, z * height]));
  // Each joint's own world rest rotation: a turn about a slanted axis that differs joint to joint.
  const worldQ: Quat[] = rows.map((_, i) => (twist ? qmul(turn, qaxis(Math.sin(i * 1.7) + 0.3, Math.cos(i * 0.9), Math.sin(i * 2.3 + 1), 0.4 + 0.37 * i)) : turn));
  const joints: TargetJoint[] = rows.map(([name, parent], i) => {
    const k = parent === null ? -1 : at.get(parent)!;
    if (k < 0) return { name, parent: -1, restP: worldP[i], restQ: worldQ[i] };
    const d: Vec3 = [worldP[i][0] - worldP[k][0], worldP[i][1] - worldP[k][1], worldP[i][2] - worldP[k][2]];
    return { name, parent: k, restP: qrot(qconj(worldQ[k]), d), restQ: qmul(qconj(worldQ[k]), worldQ[i]) };
  });
  return { joints, base: { p: [0, 0, 0], q: [0, 0, 0, 1] } };
}

/** A clip of `frames` frames whose every delta is `delta(bone, time)` and whose travel is `travel(time)`. */
export function makeClip(bones: readonly PackBone[], frames: number, duration: number, delta: (bone: string, t: number) => Quat, travel: (t: number) => Vec3 = () => [0, 0, 0]): ClipData {
  const quats = new Float32Array(frames * bones.length * 4);
  const tr = new Float32Array(frames * 3);
  for (let f = 0; f < frames; f++) {
    const t = (f * duration) / (frames - 1);
    bones.forEach((b, i) => quats.set(delta(b.name, t), (f * bones.length + i) * 4));
    tr.set(travel(t), f * 3);
  }
  return { frames, bones: bones.length, duration, quats, travel: tr };
}

/**
 * A walk made by rule: each leg swings from the hip, the two half a cycle apart, straight while its foot goes back
 * under the hips (planted) and bent at the knee while it comes forward again (lifted), so the planted foot passes
 * under the hips at up to `swing * legLength * 2 * pi / period` metres a second. `axis` 'x' walks forward (the legs
 * swing fore and aft), 'z' walks sideways to the left. `speed` is the hips' travel that way: 0 walks in place.
 */
export function walkClip(bones: readonly PackBone[], { period = 1, swing = 0.4, axis = 'x', speed = 0, frames = 31, bend = 0.9 }: { period?: number; swing?: number; axis?: 'x' | 'z'; speed?: number; frames?: number; bend?: number } = {}): ClipData {
  const w = (2 * Math.PI) / period;
  return makeClip(
    bones,
    frames,
    period,
    (bone, t) => {
      const side = bone.startsWith('Left') ? 0 : bone.startsWith('Right') ? Math.PI : null;
      if (side === null || !/(UpLeg|Leg|Foot|ToeBase)$/.test(bone)) return [0, 0, 0, 1];
      // A leg hanging down swung about +X by a goes back (toward -Z) at its foot for a > 0; about +Z it goes toward +X.
      const a = swing * Math.sin(w * t + side);
      const hip = axis === 'x' ? qaxis(1, 0, 0, a) : qaxis(0, 0, 1, a);
      if (/UpLeg$/.test(bone)) return hip;
      // The foot comes forward (the way the body goes) while the swing's rate has this sign: the knee bends then.
      const forward = (axis === 'x' ? -1 : 1) * Math.cos(w * t + side);
      return qmul(hip, qaxis(1, 0, 0, bend * Math.max(0, forward)));
    },
    (t) => (axis === 'x' ? [0, 0, speed * t] : [speed * t, 0, 0]),
  );
}

/**
 * A walk whose stride is known, laid out foot by foot and posed by the leg's own two bones (the knee found by the two
 * lengths, forward): over each stance's settled middle the foot lies flat and goes back over the ground the clip is
 * carried on (the hips' mean travel, `travel` m/s forward) at exactly `speed` m/s, so `speed` is the truth. Round it,
 * the frames a measure of the stance must not read: the heel coming down onto the ground with the toe still up (the
 * landing, the foot going back at only `landShare` of the speed), and the heel rolling up off it about a toe still
 * planted (the lifting, the ankle rising at `rise` m/s, inside the planting's own stillness but outside the middle's);
 * and over it all, the hips swaying fore and aft twice a stride by `sway` metres, which the body's own speed is none of.
 * `travel` 0 walks in place; `travel` equal to `speed` is a walk whose planted feet stand still on its own ground.
 */
export function strideWalk(bones: readonly PackBone[], { speed = 1, travel = 0, sway = 0.03, period = 1, frames = 61, stance = 0.4, lift = 0.085, land = 0.08, rise = 0.42, landShare = 0.8 }: { speed?: number; travel?: number; sway?: number; period?: number; frames?: number; stance?: number; lift?: number; land?: number; rise?: number; landShare?: number } = {}): ClipData {
  const at = (n: string) => bones.find((b) => b.name === n)!.rest;
  const hip = at('LeftUpLeg'), knee = at('LeftLeg'), ankle = at('LeftFoot'), toe = at('LeftToeBase');
  const thigh = Math.hypot(knee[1] - hip[1], knee[2] - hip[2]), shin = Math.hypot(ankle[1] - knee[1], ankle[2] - knee[2]);
  const thighRest = Math.atan2(knee[2] - hip[2], knee[1] - hip[1]), shinRest = Math.atan2(ankle[2] - knee[2], ankle[1] - knee[1]);
  // The foot, ankle to toe, in (y, z): its pitch turns it about the ankle's own axis across the body.
  const fy = toe[1] - ankle[1], fz = toe[2] - ankle[2];
  const pitch = (p: number): [number, number] => [fy * Math.cos(p) - fz * Math.sin(p), fy * Math.sin(p) + fz * Math.cos(p)];
  const drop = 0.1;
  const P = period;
  // A heel rising at `rise` turns the foot about its toe at this rate (the ankle's lever, across, is the foot's own fore and aft length).
  const spin = rise / fz;
  const liftPitch = spin * lift;
  const landPitch = -liftPitch;
  // Where the ankle stands over its own rest height as the heel starts down.
  const landHigh = rise * land;
  // One foot's ankle (z, y) on the carried ground and its pitch, at a phase of its stride.
  const footAt = (u: number): { z: number; y: number; p: number } => {
    const restY = ankle[1];
    const start = speed * stance * P * 0.5;
    if (u < stance) return { z: start - speed * u * P, y: restY, p: 0 };
    const flatEnd = start - speed * stance * P;
    const toeEnd0 = flatEnd + fz;
    if (u < stance + lift / P) {
      const tau = (u - stance) * P;
      const tz = toeEnd0 - speed * tau;
      const [py, pz] = pitch(spin * tau);
      return { z: tz - pz, y: toe[1] - py, p: spin * tau };
    }
    const liftEnd = (() => {
      const tz = toeEnd0 - speed * lift;
      const [py, pz] = pitch(liftPitch);
      return { z: tz - pz, y: toe[1] - py };
    })();
    const landStartU = 1 - land / P;
    const landFrom = { z: start + landShare * speed * land, y: restY + landHigh };
    if (u >= landStartU) {
      const tau = (u - landStartU) * P;
      return { z: landFrom.z - landShare * speed * tau, y: landFrom.y - rise * tau, p: landPitch * (1 - tau / land) };
    }
    // The swing: forward over a lifted arc, the pitch turning from the lifting's to the landing's.
    const w = (u - (stance + lift / P)) / (landStartU - (stance + lift / P));
    const e = w * w * (3 - 2 * w);
    return { z: liftEnd.z + (landFrom.z - liftEnd.z) * e, y: liftEnd.y + (landFrom.y - liftEnd.y) * e + 0.12 * Math.sin(Math.PI * w), p: liftPitch + (landPitch - liftPitch) * e };
  };
  const hipsAt = (t: number) => travel * t + sway * Math.sin((4 * Math.PI * t) / P + 1.1);
  // The leg's two bones to put the ankle at (z, y) from the hip joint, the knee forward: each bone's turn about +X.
  const legTurns = (dz: number, dy: number): [number, number] => {
    const d = Math.hypot(dz, dy);
    const x = (thigh * thigh - shin * shin + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, thigh * thigh - x * x));
    const ez = dz / d, ey = dy / d;
    const kz = x * ez + h * -ey, ky = x * ey + h * ez;
    return [Math.atan2(kz, ky) - thighRest, Math.atan2(dz - kz, dy - ky) - shinRest];
  };
  return makeClip(
    bones,
    frames,
    P,
    (bone, t) => {
      const side = bone.startsWith('Left') ? 0 : bone.startsWith('Right') ? 0.5 : null;
      if (side === null || !/(UpLeg|Leg|Foot)$/.test(bone)) return [0, 0, 0, 1];
      const u = (((t / P + side) % 1) + 1) % 1;
      const f = footAt(u);
      const hz = hipsAt(t) - travel * t;
      const [a1, a2] = legTurns(f.z - (hip[2] + hz), f.y - (hip[1] - drop));
      return qaxis(1, 0, 0, /UpLeg$/.test(bone) ? a1 : /Leg$/.test(bone) ? a2 : f.p);
    },
    (t) => [0, -drop, hipsAt(t)],
  );
}

/**
 * How fast that walk's planted foot passes under the hips at its fastest, m/s: the swing's rate times the leg from hip
 * to the foot's middle, halfway from the ankle to the toe (the point the importer reads a foot's speed off: the mean of
 * its two). The walk swings the whole leg about the hip, so the toe, further out, goes faster than the ankle.
 */
export function walkTopSpeed(bones: readonly PackBone[], period = 1, swing = 0.4): number {
  const at = (n: string) => bones.find((b) => b.name === n)!.rest;
  const hip = at('LeftUpLeg'), ankle = at('LeftFoot'), toe = at('LeftToeBase');
  const mid = [0, 1, 2].map((i) => (ankle[i] + toe[i]) / 2);
  return Math.hypot(hip[0] - mid[0], hip[1] - mid[1], hip[2] - mid[2]) * swing * ((2 * Math.PI) / period);
}

/** A converted body's skeleton, from its GLB's JSON chunk: the skin's joints parent first, each with its rest under its parent. */
export function glbSkeleton(file: string): TargetSkeleton {
  const buf = readFileSync(file);
  const gltf = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8')) as {
    nodes: { name?: string; extras?: { name?: string }; children?: number[]; translation?: number[]; rotation?: number[] }[];
    skins?: { joints: number[] }[];
  };
  const nodes = gltf.nodes;
  const parent = new Array<number>(nodes.length).fill(-1);
  nodes.forEach((n, i) => (n.children ?? []).forEach((c) => (parent[c] = i)));
  const isJoint = new Set((gltf.skins ?? []).flatMap((s) => s.joints));
  const depth = (i: number) => {
    let d = 0;
    for (let p = parent[i]; p >= 0; p = parent[p]) d++;
    return d;
  };
  const order = [...isJoint].sort((a, b) => depth(a) - depth(b) || a - b);
  const at = new Map(order.map((n, i) => [n, i]));
  const joints: TargetJoint[] = order.map((i) => ({
    name: nodes[i].extras?.name ?? nodes[i].name ?? `joint${i}`,
    parent: parent[i] >= 0 && at.has(parent[i]) ? at.get(parent[i])! : -1,
    restP: (nodes[i].translation ?? [0, 0, 0]) as Vec3,
    restQ: (nodes[i].rotation ?? [0, 0, 0, 1]) as Quat,
  }));
  return { joints, base: { p: [0, 0, 0], q: [0, 0, 0, 1] } };
}

/** Every converted species on disk, with its body's GLB: empty without the packs. */
export function speciesBodies(root: string): { id: string; body: string }[] {
  const dir = join(root, 'assets-private', 'characters');
  if (!existsSync(dir)) return [];
  const out: { id: string; body: string }[] = [];
  for (const id of readdirSync(dir).sort()) {
    const parts = join(dir, id, 'parts.json');
    if (!existsSync(parts)) continue;
    try {
      const m = JSON.parse(readFileSync(parts, 'utf8')) as { parts: { file: string; body?: boolean }[] };
      const body = m.parts.find((p) => p.body) ?? m.parts[0];
      if (body && existsSync(join(dir, id, body.file))) out.push({ id, body: join(dir, id, body.file) });
    } catch {
      // A pack that cannot be read is no body to fit: the converter's own tests say so.
    }
  }
  return out;
}

/** The repository's root, from a test's own place. */
export const repoRoot = (here: string): string => decodeURIComponent(new URL('../../../', here).pathname).replace(/^\/([A-Za-z]:)/, '$1');
