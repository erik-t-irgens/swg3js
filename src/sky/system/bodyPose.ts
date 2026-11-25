// A body's true pose and its size by distance under an applied star system (the GPU port's sky round "the sky's bodies as the
// system has them", maker P: the brief's B and C). One pure module the game (`skyMotion.ts`, `lookBody.ts`) and the viewer's
// ground view (`placeview.js`) both call on the very same `system.js` model and state, so the two agree to the bit.
//
// **The pose (B).** Each body's spin axis, the meridian its look's longitude 0 faces, and so its rings (its equator, or its
// look's ring tilt from it) and its bands, are held in the SYSTEM's frame and turned into the sky by the system's own turn
// (`state.R`, the turn the stars share: `SkyMotion.celestial`), so a ring keeps its tilt against the stars and tips as the body
// crosses the sky, and the light on it (the system's `light`) moves only as it goes round its orbit:
//   - the axis: a locked ground world's the clockwork's own (`state.axis`, its lean kept against its sun); another ground world
//     leans `axialTilt` from its year's orbit toward its fixed time of year, as the world you stand on does (`skyAt2`'s rule);
//     every other body leans `axialTilt` from its own orbit's pole about that orbit's node line (the brief's "a node": the
//     drafts name no other line, so the orbit's own is taken);
//   - the meridian: a locked body's (`locked`, or a locked ground world's) faces its parent, never turning; every other
//     body's starts on its orbit's node line, and the look turns about its axis by the body's own spin (`spinTurn`), as before.
// The pose is three columns in the sky's frame (+Y up, +X where the sun sets, +Z north): the look's own x, its axis (the look's
// +y, which its spin turns about) and its meridian (the look's +z, the face the viewer's stage shows first).
//
// **The size by distance (C).** A body's size setting is its size at its average distance from the world one stands on
// (worked out once at the arrival, `distanceKitOf`: the clockwork sampled over a long span), its radius `tan(size / 2)` times
// that distance; drawn, it is `2 atan(radius / distance)` now, mixed with the setting by the "size follows distance" dial
// (`MOTION_TUNE.distanceSize`, 0 the setting as before, 1 the true size). A star and a painted sheet keep their setting.
//
// Nothing here touches three or a page; a frame's call allocates nothing (kept arrays, numbers in fields and locals).

import { makeSkyState, skyAtNext } from './system.js';

const DEG = Math.PI / 180;

/** What the pose and the distances read of `system.js`' model (`compileSystem`'s answer; version 1 or 2). */
export interface PoseModel {
  version?: number;
  n: number;
  m: number;
  parent: Int16Array;
  basis: Float64Array;
  worldI: number;
  sunI: number;
  itemBody: Int16Array;
  itemStar: Uint8Array;
  itemSheet: Uint8Array;
  itemSize: Float64Array;
  itemSpin?: Float64Array;
  items: readonly { turns?: number }[];
  axialTilt?: Float64Array;
  lockDay?: Float64Array;
  yearOf?: Int16Array;
  period: Float64Array;
  sys: { bodies: readonly { id: string; kind: string; locked?: boolean }[]; grounds?: readonly { world: string; body: string | null; copy: string | null; season: number | null }[] };
}

/** What they read of its state (`makeSkyState`): positions, the orbits' frames now, the axes, the sky's turn, distances. */
export interface PoseState {
  pos: Float64Array;
  basis?: Float64Array;
  axis?: Float64Array;
  R: Float64Array;
  dist: Float64Array;
  next: number;
}

/** How each body's axis is found (`poseKitOf`): its orbit's pole leaned by its tilt, a locked ground world's own, a ground world's season. */
const RULE_ORBIT = 0;
const RULE_LOCKED_AXIS = 1;
const RULE_SEASON = 2;

/** A model's pose rules, made once at an arrival (or a model's making in the viewer). */
export interface PoseKit {
  readonly rule: Int8Array;
  /** A ground world's fixed time of year (radians), for the season rule. */
  readonly season: Float64Array;
  /** Whether a body keeps one face to its parent (its look does not turn of itself). */
  readonly locked: Uint8Array;
  /** Each item's look turns by its own spin (degrees a real day, or version 1's turns), 0 for a locked body or none. */
  readonly spinDeg: Float64Array;
}

/** The rules of a model's bodies (made once; never in a frame). */
export function poseKitOf(M: PoseModel): PoseKit {
  const n = M.n;
  const rule = new Int8Array(n);
  const season = new Float64Array(n);
  const locked = new Uint8Array(n);
  const v2 = M.version === 2;
  const grounds = v2 ? M.sys.grounds ?? [] : [];
  for (let i = 0; i < n; i++) {
    const b = M.sys.bodies[i];
    if (v2 && M.lockDay && M.lockDay[i] > 0) {
      rule[i] = RULE_LOCKED_AXIS;
      locked[i] = 1;
      continue;
    }
    const g = grounds.find((x) => !x.copy && x.body === b.id);
    if (g && M.yearOf && M.yearOf[i] >= 0) {
      rule[i] = RULE_SEASON;
      season[i] = (g.season ?? 0) * DEG;
    }
    if (b.locked === true && M.parent[i] >= 0) locked[i] = 1;
  }
  const m = M.m;
  const spinDeg = new Float64Array(m);
  for (let j = 0; j < m; j++) {
    const i = M.itemBody[j];
    if (locked[i]) continue;
    spinDeg[j] = v2 ? (M.itemSpin?.[j] ?? 0) : (M.items[j].turns ?? 0) * 360;
  }
  return { rule, season, locked, spinDeg };
}

/**
 * Every item's pose now (`poses`: nine numbers an item, the look's x, its axis and its meridian as columns in the sky's frame),
 * from the model and its state as `skyAt` last left them. Stars and painted sheets get the sky's own axes. Allocates nothing.
 */
export function bodyPosesInto(M: PoseModel, st: PoseState, kit: PoseKit, poses: Float64Array): void {
  const R = st.R;
  const pos = st.pos;
  const basis = st.basis ?? M.basis;
  const ax = st.axis;
  const tilt = M.axialTilt;
  const sun3 = 3 * M.sunI;
  for (let j = 0; j < M.m; j++) {
    const o = 9 * j;
    const i = M.itemBody[j];
    if (M.itemStar[j] || M.itemSheet[j] || i < 0) {
      poses[o] = 1;
      poses[o + 1] = 0;
      poses[o + 2] = 0;
      poses[o + 3] = 0;
      poses[o + 4] = 1;
      poses[o + 5] = 0;
      poses[o + 6] = 0;
      poses[o + 7] = 0;
      poses[o + 8] = 1;
      continue;
    }
    const b9 = 9 * i;
    // the orbit's node line u, the line a quarter round v, its pole N (as its frame stands now)
    const ux = basis[b9];
    const uy = basis[b9 + 1];
    const uz = basis[b9 + 2];
    const vx = basis[b9 + 3];
    const vy = basis[b9 + 4];
    const vz = basis[b9 + 5];
    const Nx = basis[b9 + 6];
    const Ny = basis[b9 + 7];
    const Nz = basis[b9 + 8];
    let Ax = Nx;
    let Ay = Ny;
    let Az = Nz;
    const r = kit.rule[i];
    if (r === RULE_LOCKED_AXIS && ax) {
      Ax = ax[3 * i];
      Ay = ax[3 * i + 1];
      Az = ax[3 * i + 2];
    } else if (r === RULE_SEASON && M.yearOf) {
      // `skyAt2`'s rule for the world you stand on: the sun square to its year's pole, the lean toward the fixed time of year
      const yb = 9 * M.yearOf[i];
      const Yx = basis[yb + 6];
      const Yy = basis[yb + 7];
      const Yz = basis[yb + 8];
      const i3 = 3 * i;
      const wx = pos[sun3] - pos[i3];
      const wy = pos[sun3 + 1] - pos[i3 + 1];
      const wz = pos[sun3 + 2] - pos[i3 + 2];
      const d = wx * Yx + wy * Yy + wz * Yz;
      let sx = wx - d * Yx;
      let sy = wy - d * Yy;
      let sz = wz - d * Yz;
      let l = Math.sqrt(sx * sx + sy * sy + sz * sz);
      if (l < 1e-12) {
        sx = basis[yb];
        sy = basis[yb + 1];
        sz = basis[yb + 2];
        l = 1;
      }
      sx /= l;
      sy /= l;
      sz /= l;
      const ex = Yy * sz - Yz * sy;
      const ey = Yz * sx - Yx * sz;
      const ez = Yx * sy - Yy * sx;
      const e = tilt ? tilt[i] : 0;
      const ce = Math.cos(e);
      const se = Math.sin(e);
      const sl = Math.sin(kit.season[i]);
      const cl = Math.cos(kit.season[i]);
      Ax = ce * Yx + se * (sl * sx + cl * ex);
      Ay = ce * Yy + se * (sl * sy + cl * ey);
      Az = ce * Yz + se * (sl * sz + cl * ez);
    } else if (tilt) {
      // the orbit's pole leaned by the axial tilt about the node line (u x N = -v in the orbit's right-handed frame)
      const e = tilt[i];
      if (e !== 0) {
        const ce = Math.cos(e);
        const se = Math.sin(e);
        Ax = ce * Nx - se * vx;
        Ay = ce * Ny - se * vy;
        Az = ce * Nz - se * vz;
      }
    }
    let al = Math.sqrt(Ax * Ax + Ay * Ay + Az * Az);
    if (al < 1e-12) {
      Ax = 0;
      Ay = 0;
      Az = 1;
      al = 1;
    }
    Ax /= al;
    Ay /= al;
    Az /= al;
    // the meridian: toward the parent for a locked body, else the node line; made square to the axis
    let mx = ux;
    let my = uy;
    let mz = uz;
    const p = M.parent[i];
    if (kit.locked[i] && p >= 0) {
      const i3 = 3 * i;
      const p3 = 3 * p;
      mx = pos[p3] - pos[i3];
      my = pos[p3 + 1] - pos[i3 + 1];
      mz = pos[p3 + 2] - pos[i3 + 2];
    }
    let dm = mx * Ax + my * Ay + mz * Az;
    mx -= dm * Ax;
    my -= dm * Ay;
    mz -= dm * Az;
    let ml = Math.sqrt(mx * mx + my * my + mz * mz);
    if (ml < 1e-9) {
      // along the axis: the orbit's quarter line instead, else the system's +X
      mx = vx;
      my = vy;
      mz = vz;
      dm = mx * Ax + my * Ay + mz * Az;
      mx -= dm * Ax;
      my -= dm * Ay;
      mz -= dm * Az;
      ml = Math.sqrt(mx * mx + my * my + mz * mz);
      if (ml < 1e-9) {
        mx = 1 - Ax * Ax;
        my = -Ax * Ay;
        mz = -Ax * Az;
        ml = Math.sqrt(mx * mx + my * my + mz * mz);
        if (ml < 1e-12) {
          mx = 0;
          my = 1;
          mz = 0;
          ml = 1;
        }
      }
    }
    mx /= ml;
    my /= ml;
    mz /= ml;
    // into the sky by the system's turn (row after row)
    const Yx = R[0] * Ax + R[1] * Ay + R[2] * Az;
    const Yy = R[3] * Ax + R[4] * Ay + R[5] * Az;
    const Yz = R[6] * Ax + R[7] * Ay + R[8] * Az;
    const Zx = R[0] * mx + R[1] * my + R[2] * mz;
    const Zy = R[3] * mx + R[4] * my + R[5] * mz;
    const Zz = R[6] * mx + R[7] * my + R[8] * mz;
    poses[o] = Yy * Zz - Yz * Zy;
    poses[o + 1] = Yz * Zx - Yx * Zz;
    poses[o + 2] = Yx * Zy - Yy * Zx;
    poses[o + 3] = Yx;
    poses[o + 4] = Yy;
    poses[o + 5] = Yz;
    poses[o + 6] = Zx;
    poses[o + 7] = Zy;
    poses[o + 8] = Zz;
  }
}

/** A quaternion's fields as three keeps them (`_x`, `_y`, `_z`, `_w`): written in place, no setter, no callback. */
export interface QuatFields {
  _x: number;
  _y: number;
  _z: number;
  _w: number;
}

/**
 * Item `j`'s pose (`poses`' columns) as a turn, written into `q`'s own fields (three's `setFromRotationMatrix` written out, as
 * `lookBody.ts`' card's turn is): the look's axis group turned so its +y is the body's axis and its +z its meridian. Allocates
 * nothing.
 */
export function poseQuatInto(poses: Float64Array, j: number, q: QuatFields): void {
  const o = 9 * j;
  const m11 = poses[o];
  const m21 = poses[o + 1];
  const m31 = poses[o + 2];
  const m12 = poses[o + 3];
  const m22 = poses[o + 4];
  const m32 = poses[o + 5];
  const m13 = poses[o + 6];
  const m23 = poses[o + 7];
  const m33 = poses[o + 8];
  const trace = m11 + m22 + m33;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    q._w = 0.25 / s;
    q._x = (m32 - m23) * s;
    q._y = (m13 - m31) * s;
    q._z = (m21 - m12) * s;
  } else if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
    q._w = (m32 - m23) / s;
    q._x = 0.25 * s;
    q._y = (m12 + m21) / s;
    q._z = (m13 + m31) / s;
  } else if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
    q._w = (m13 - m31) / s;
    q._x = (m12 + m21) / s;
    q._y = 0.25 * s;
    q._z = (m23 + m32) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
    q._w = (m21 - m12) / s;
    q._x = (m13 + m31) / s;
    q._y = (m23 + m32) / s;
    q._z = 0.25 * s;
  }
}

// ---------------------------------------------------------------- the size by distance (C)

/** Each item's distances from the world one stands on over a long span: its mean, nearest and farthest (model units). */
export interface DistanceKit {
  readonly mean: Float64Array;
  readonly near: Float64Array;
  readonly far: Float64Array;
}

/** How many moments the clockwork is sampled at for the distances, and over how many of its longest period (at least a year). */
export const DISTANCE_SAMPLES = 2048;
const SPAN_PERIODS = 24;
/** The golden ratio's fraction: moments spread evenly over the span with no beat against any period. */
const GOLDEN = 0.6180339887498949;

/**
 * Each item's mean, nearest and farthest distance from the world one stands on, the clockwork run at `DISTANCE_SAMPLES` moments
 * spread over 24 of its longest period (a moon's distance from the world it goes round is its radius to the bit). Made once at
 * an arrival (or a model's making in the viewer), on a state of its own; the same model gives the same numbers anywhere.
 */
export function distanceKitOf(M: PoseModel): DistanceKit {
  const m = M.m;
  const mean = new Float64Array(m);
  const near = new Float64Array(m).fill(Infinity);
  const far = new Float64Array(m);
  let longest = 1;
  for (let i = 0; i < M.n; i++) if (M.period[i] > longest) longest = M.period[i];
  const ld = M.lockDay;
  if (ld) for (let i = 0; i < M.n; i++) if (ld[i] > longest) longest = ld[i];
  const span = Math.min(1e6, longest * SPAN_PERIODS);
  const st = makeSkyState(M as unknown as Record<string, unknown>) as unknown as PoseState;
  for (let k = 0; k < DISTANCE_SAMPLES; k++) {
    const f = (k + 0.5) * GOLDEN;
    st.next = span * (f - Math.floor(f));
    skyAtNext(M as unknown as Record<string, unknown>, st as unknown as Record<string, unknown>);
    for (let j = 0; j < m; j++) {
      const d = st.dist[j];
      mean[j] += d;
      if (d < near[j]) near[j] = d;
      if (d > far[j]) far[j] = d;
    }
  }
  for (let j = 0; j < m; j++) {
    mean[j] /= DISTANCE_SAMPLES;
    if (!(near[j] < Infinity)) near[j] = mean[j];
    // a distance that never moves (a moon of the world one stands on) is its own mean, to the bit
    if (far[j] - near[j] <= 1e-12 * (far[j] > 0 ? far[j] : 1)) mean[j] = near[j];
  }
  return { mean, near, far };
}

/** The most a drawn body may grow to (degrees): a body nearer than its own radius fills no more than this. */
const MOST_DEG = 170;

/**
 * A body's drawn size now (degrees): its setting `sizeDeg` at its mean distance `mean`, seen at `dist`, mixed with the setting by
 * `follow` (0 the setting, 1 the true size). Plain numbers in and out, inlined by its callers' compilers (a number handed back
 * from a call that is not built in is a number made: the frame's callers write it out themselves, `sizesInto`).
 */
export function drawnSizeDeg(sizeDeg: number, mean: number, dist: number, follow: number): number {
  if (!(follow > 0) || !(mean > 0) || !(dist > 0) || Math.abs(dist - mean) < 1e-12 * mean) return sizeDeg;
  const r = Math.tan((sizeDeg * DEG) / 2) * mean;
  let t = (2 * Math.atan(r / dist)) / DEG;
  if (t > MOST_DEG) t = MOST_DEG;
  return sizeDeg + follow * (t - sizeDeg);
}

/**
 * Every item's drawn size now into `out` (degrees), from the model's settings, the kit's means and the state's distances, the dial
 * `tune.distanceSize` (`MOTION_TUNE`): a star and a painted sheet keep their setting. Allocates nothing.
 */
export function sizesInto(M: PoseModel, st: { dist: Float64Array }, kit: DistanceKit, tune: { readonly distanceSize: number }, out: Float64Array): void {
  // (the dial read off its record: a number handed across a call the compiler does not build in is a number made)
  const follow = tune.distanceSize;
  const f = follow > 0 ? (follow < 1 ? follow : 1) : 0;
  for (let j = 0; j < M.m; j++) {
    const s = M.itemSize[j];
    const mean = kit.mean[j];
    const dist = st.dist[j];
    // (a distance within rounding of its mean, as a moon of a world locked to what it goes round, keeps its setting to the bit)
    const off = dist - mean;
    if (M.itemStar[j] || M.itemSheet[j] || f === 0 || !(mean > 0) || !(dist > 0) || (off < 1e-12 * mean && off > -1e-12 * mean)) {
      out[j] = s;
      continue;
    }
    const r = Math.tan((s * DEG) / 2) * mean;
    let t = (2 * Math.atan(r / dist)) / DEG;
    if (t > MOST_DEG) t = MOST_DEG;
    out[j] = s + f * (t - s);
  }
}

/** The largest an item is ever drawn (degrees, at its nearest with the dial at 1, or its setting): its picture's size. */
export function largestSizeDeg(M: PoseModel, kit: DistanceKit, j: number): number {
  const s = M.itemSize[j];
  if (M.itemStar[j] || M.itemSheet[j]) return s;
  const t = drawnSizeDeg(s, kit.mean[j], kit.near[j], 1);
  return t > s ? t : s;
}

// ---------------------------------------------------------------- the viewer's own models

/** What the viewer's ground view keeps for one of its models: the kits, the poses and sizes at the moment last worked. */
export interface ModelPose {
  readonly kit: PoseKit;
  readonly dist: DistanceKit;
  readonly poses: Float64Array;
  readonly sizes: Float64Array;
  T: number;
  follow: number;
}

const MODEL_POSES = new WeakMap<object, ModelPose>();
const FOLLOW = { distanceSize: 1 };

/**
 * The poses and drawn sizes of a viewer's model at its state's moment (`placeview.js`; the game's `SkyMotion` keeps its own),
 * worked again only when the moment or the dial moves: the same functions as the game's frame.
 */
export function modelPoseOf(M: PoseModel, st: PoseState & { T: number }, follow: number): ModelPose {
  let c = MODEL_POSES.get(M);
  if (!c) {
    c = { kit: poseKitOf(M), dist: distanceKitOf(M), poses: new Float64Array(9 * M.m), sizes: new Float64Array(M.m), T: Number.NaN, follow: -1 };
    MODEL_POSES.set(M, c);
  }
  if (c.T !== st.T || c.follow !== follow) {
    bodyPosesInto(M, st, c.kit, c.poses);
    FOLLOW.distanceSize = follow;
    sizesInto(M, st, c.dist, FOLLOW, c.sizes);
    c.T = st.T;
    c.follow = follow;
  }
  return c;
}
