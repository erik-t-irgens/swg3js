// The room's air, checked without a browser: which way a doorway faces into its room, the box its
// sunbeam is clipped to and how far the beam reaches, the map to the beam's unit prism and back,
// the soft beam along a view ray against a numeric integral, the noise octaves' fade, a lamp's glow
// in closed form, the scattering phase, where a mote is drawn and how evenly its sprite lights the
// pixels it covers, the sun samples on arched and concave doorways, and, when the converted packs
// are here, every real doorway and lamp. Then `RoomAir` itself, driven frame by frame with a stub
// world, physics and portal renderer: the hold and fade, the door-line flip, the beams' slots, the
// lit tests, the lamps' sight, packing and carry-over across a room change, the motes and a ship.
// The shaders in `src/core/fx/lightShafts.ts` and `src/world/roomAirShaders.ts` are meant to do the
// sums `roomAirMath.ts` does; only the noise frequencies are tied to it here, the rest is checked by
// reading them. Nothing is written; only counts are printed.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { register } from 'node:module';
import * as THREE from 'three';
import {
  apertureSamples,
  cellBoxes,
  clampToBox,
  exitApertures,
  invertAffine,
  lampIntegral,
  moteSpriteSum,
  moteWrap,
  mulberry32,
  neighbourCells,
  NOISE_FREQ,
  normaliseBox,
  octaveFade,
  phaseHG,
  rayBoxRange,
  readRoomAirSettings,
  ROOM_AIR_SETTING_DEFAULTS,
  shaftBasis,
  shaftReach,
  shrinkBox,
  slab,
  softBand,
  softSegment,
  type ExitAperture,
  type RoomAirSettings,
  type RoomBox,
  type RoomModelDef,
  type Vec3,
} from '../../../src/world/roomAirMath.ts';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const nearV = (a: readonly number[], b: readonly number[], tol: number) => a.every((x, k) => near(x, b[k], tol));
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const inside = (p: Vec3, b: RoomBox, eps = 0) => p.every((x, k) => x >= b.min[k] - eps && x <= b.max[k] + eps);
function minPair(ps: Vec3[]): number {
  let m = Infinity;
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) m = Math.min(m, dist(ps[i], ps[j]));
  return m;
}
/** Whether p lies in one of the triangles (within eps of its plane). */
function inTriangles(p: Vec3, verts: Vec3[], tris: number[], eps = 1e-6): boolean {
  for (let t = 0; t + 2 < tris.length; t += 3) {
    const a = verts[tris[t]];
    const b = verts[tris[t + 1]];
    const c = verts[tris[t + 2]];
    const v0: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const v1: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v2: Vec3 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const d = (x: Vec3, y: Vec3) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
    const n: Vec3 = [v1[1] * v0[2] - v1[2] * v0[1], v1[2] * v0[0] - v1[0] * v0[2], v1[0] * v0[1] - v1[1] * v0[0]];
    const nl = Math.hypot(...n);
    if (nl < 1e-12 || Math.abs(d(n, v2)) / nl > 1e-3) continue;
    const d00 = d(v0, v0), d01 = d(v0, v1), d02 = d(v0, v2), d11 = d(v1, v1), d12 = d(v1, v2);
    const den = d00 * d11 - d01 * d01;
    if (Math.abs(den) < 1e-15) continue;
    const u = (d11 * d02 - d01 * d12) / den;
    const w = (d00 * d12 - d01 * d02) / den;
    if (u >= -eps && w >= -eps && u + w <= 1 + eps) return true;
  }
  return false;
}

/** A room of one cell with one doorway onto the world (and the shell linking back), as a pack's layout has it. */
function room(bounds: { min: number[]; max: number[] }, v: number[][], i: number[]): RoomModelDef {
  return {
    cells: [
      { index: 0, name: 'r0', bounds: { min: [-10, -10, -10], max: [10, 10, 10] }, portals: [{ geometry: 0, target: 1 }] },
      { index: 1, name: 'foyer', bounds, portals: [{ geometry: 0, target: 0 }] },
    ],
    portals: [{ v, i }],
  };
}
const DOOR = [
  [1, 0, 0],
  [2, 0, 0],
  [2, 2.2, 0],
  [1, 2.2, 0],
];
const CCW = [0, 1, 2, 0, 2, 3];
const CW = [0, 2, 1, 0, 3, 2];
const BOX = { min: [0, 0, 0], max: [4, 3, 5] };

// ---- 1. A synthetic room ----
const case1: ExitAperture[] = [];
for (const [name, tris] of [['counter-clockwise', CCW], ['clockwise', CW]] as const) {
  const ap = exitApertures(room(BOX, DOOR, tris));
  ok(ap.length === 1, `one doorway found (${name} winding)`);
  const a = ap[0];
  case1.push(a);
  ok(nearV(a.inward, [0, 0, 1], 1e-12), `the doorway faces into the room, +z (${name})`);
  ok(a.decidedBy === 'probes', `the probes decide it (${name})`);
  ok(near(a.width, 1, 1e-9) && near(a.height, 2.2, 1e-9) && near(a.area, 2.2, 1e-9), `width 1, height 2.2, area 2.2 (${name})`);
  ok(a.samples.length === 5 && a.samples.every((s) => near(s[2], 0, 1e-12) && s[0] >= 1 && s[0] <= 2 && s[1] >= 0 && s[1] <= 2.2), `five sun samples on the doorway (${name})`);
  ok(minPair(a.samples) >= 0.2, `no two sun samples closer than 0.2 m (${name}: ${minPair(a.samples).toFixed(3)})`);
}

// ---- 2. A huge box: the probes cannot tell, the centre decides ----
for (const [name, tris] of [['counter-clockwise', CCW], ['clockwise', CW]] as const) {
  const a = exitApertures(room({ min: [-100, -100, -50], max: [100, 100, 150] }, DOOR, tris))[0];
  ok(a.decidedBy === 'centre' && nearV(a.inward, [0, 0, 1], 1e-12), `in a 200 m box the box's centre decides, still +z (${name})`);
}

// ---- 3. A box given max before min ----
{
  const a = exitApertures(room({ min: [4, 3, 5], max: [0, 0, 0] }, DOOR, CCW))[0];
  ok(nearV(normaliseBox({ min: [4, 3, 5], max: [0, 0, 0] }).min, [0, 0, 0], 0) && nearV(normaliseBox({ min: [4, 3, 5], max: [0, 0, 0] }).max, [4, 3, 5], 0), 'a box given max first is taken componentwise');
  const b = case1[0];
  ok(nearV(a.inward, b.inward, 0) && nearV(a.origin, b.origin, 0) && near(a.width, b.width, 0) && nearV(a.shaftBox.min, b.shaftBox.min, 0) && nearV(a.shaftBox.max, b.shaftBox.max, 0), 'and the doorway comes out the same as case 1');
}

// ---- 4. The unit prism and back ----
{
  const a = case1[0];
  const t0: Vec3 = [0.3, -0.5, 0.8];
  const tl = Math.hypot(...t0);
  const travel: Vec3 = [t0[0] / tl, t0[1] / tl, t0[2] / tl];
  const reach = shaftReach(a, travel, 60);
  const m = shaftBasis(a, travel, reach, new Array(16).fill(0));
  const inv = invertAffine(m, new Array(16).fill(0));
  const apply = (M: number[], p: Vec3): Vec3 => [M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12], M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13], M[2] * p[0] + M[6] * p[1] + M[10] * p[2] + M[14]];
  const rnd = mulberry32(4);
  let worst = 0;
  for (let k = 0; k < 100; k++) {
    const p: Vec3 = [rnd() * 8 - 2, rnd() * 6 - 1, rnd() * 10 - 2];
    worst = Math.max(worst, dist(apply(m, apply(inv, p)), p));
  }
  ok(worst < 1e-9, `100 room points map to the unit prism and back within 1e-9 (${worst.toExponential(1)})`);
  ok(nearV(apply(m, [0, 0, 0]), a.origin, 1e-12), 'unit (0, 0, 0) is the doorway rectangle\'s origin');
  ok(nearV(apply(m, [1, 1, 0]), [2, 2.2, 0], 1e-12), 'unit (1, 1, 0) is the opposite doorway corner');
}

// ---- 5. The shaft box and the reach ----
{
  const a = case1[0];
  ok(nearV(a.shaftBox.min, [-0.05, -0.3, -0.3], 1e-12) && nearV(a.shaftBox.max, [4.05, 3.05, 5.05], 1e-12), 'the shaft box is the room padded 0.05 m united with the doorway padded 0.3 m');
  const moved = exitApertures(room(BOX, DOOR.map((p) => [p[0], p[1], -0.3]), CCW))[0];
  ok(nearV(moved.inward, [0, 0, 1], 0), 'a doorway 0.3 m outside its room\'s face still faces in');
  ok(moved.verts.every((p) => p[2] - moved.shaftBox.min[2] >= 0.25 && inside(p, moved.shaftBox)), 'and every vertex of it lies at least 0.25 m inside the shaft box on z');
  const s30 = Math.sin(Math.PI / 6);
  const travel: Vec3 = [0, -s30, Math.cos(Math.PI / 6)];
  const reach = shaftReach(a, travel, 60);
  ok(near(reach, (2.2 + 0.3) / s30, 1e-6), `a beam 30 degrees down reaches (2.2 + 0.3) / sin 30 = 5 m, the floor of the shaft box (${reach.toFixed(6)})`);
  let starts = -Infinity;
  for (let i = 0; i < 5; i++) {
    const fu = i === 4 ? 0.5 : i & 1 ? 1 : 0;
    const fv = i === 4 ? 0.5 : i & 2 ? 1 : 0;
    const p: Vec3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) p[k] = a.origin[k] + a.u[k] * a.width * fu + a.v[k] * a.height * fv + a.inward[k] * 0.02;
    starts = Math.max(starts, rayBoxRange(p, travel, a.shaftBox)[0]);
  }
  ok(starts <= 0, 'every reach ray starts inside the shaft box');
}

// ---- 6. The soft beam along a ray, against a numeric integral ----
{
  const rnd = mulberry32(6);
  const rel: number[] = [];
  let exact = 0;
  let checked = 0;
  for (let n = 0; n < 500; n++) {
    const W = 1 + rnd() * 3;
    const H = 2 + rnd() * 2;
    const T = 2 + rnd() * 8;
    const soft = 0.06 + rnd() * 0.24;
    const ea = soft / W;
    const eb = soft / H;
    // A point in (or just around) the prism, and a ray through it; one in five grazes a face.
    const target: Vec3 = [rnd() * 1.2 - 0.1, rnd() * 1.2 - 0.1, rnd()];
    let dm: Vec3 = [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1];
    if (n % 5 === 0) dm = [rnd() * 0.05 - 0.025, rnd() * 2 - 1, rnd() * 2 - 1];
    const dl = Math.hypot(...dm) || 1;
    dm = [dm[0] / dl, dm[1] / dl, dm[2] / dl];
    const d: Vec3 = [dm[0] / W, dm[1] / H, dm[2] / T];
    const back = 1 + rnd() * 12;
    const o: Vec3 = [target[0] - d[0] * back, target[1] - d[1] * back, target[2] - d[2] * back];
    const s1 = back + rnd() * 10;
    const got = softSegment(o, d, ea, eb, 0, s1);
    const steps = 4000;
    let want = 0;
    for (let k = 0; k < steps; k++) {
      const s = ((k + 0.5) / steps) * s1;
      const z = o[2] + d[2] * s;
      if (z < 0 || z > 1) continue;
      want += softBand(o[0] + d[0] * s, ea) * softBand(o[1] + d[1] * s, eb) * (s1 / steps);
    }
    if (want > 0.2) {
      rel.push(Math.abs(got - want) / want);
      checked++;
    }
    // With no soft edge it is the slab's length exactly.
    const hard = softSegment(o, d, 0, 0, 0, s1);
    const r = slab(o, d, [0, 0, 0], [1, 1, 1]);
    const lo = Math.max(r[0], 0);
    const hi = Math.min(r[1], s1);
    if (Math.abs(hard - Math.max(0, hi - lo)) < 1e-9) exact++;
  }
  rel.sort((a, b) => a - b);
  const p95 = rel[Math.floor(rel.length * 0.95)];
  ok(checked > 100 && p95 < 0.15, `the four-sample soft segment is within 15% of the numeric integral at p95 over ${checked} paths longer than 0.2 m (p50 ${rel[Math.floor(rel.length / 2)].toFixed(3)}, p95 ${p95.toFixed(3)})`);
  ok(exact === 500, 'with no soft edge it is the slab length exactly on all 500 rays');
}

// ---- 7. The noise octaves fade where four samples cannot resolve them ----
{
  ok(octaveFade(4.3, 0.1) === 1, 'a fine octave over 10 cm keeps its whole weight');
  ok(octaveFade(4.3, 1) === 0 && octaveFade(1.7, 3) === 0, 'over a metre (fine) or three (coarse) an octave is its mean alone');
  let mono = true;
  for (const f of [1.7, 4.3]) {
    let last = 1;
    for (let s = 0; s <= 10; s += 0.01) {
      const v = octaveFade(f, s);
      if (v > last + 1e-12) mono = false;
      last = v;
    }
  }
  ok(mono, 'the fade never rises as the span grows');
}

// ---- 8. A lamp's glow in closed form ----
{
  const rnd = mulberry32(8);
  let worst = 0;
  for (let n = 0; n < 100; n++) {
    const o: Vec3 = [rnd() * 10 - 5, rnd() * 4, rnd() * 10 - 5];
    let dir: Vec3 = [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1];
    const l = Math.hypot(...dir);
    dir = [dir[0] / l, dir[1] / l, dir[2] / l];
    const lamp: Vec3 = [rnd() * 10 - 5, rnd() * 4, rnd() * 10 - 5];
    const D = 0.5 + rnd() * 20;
    const eps = 0.1 + rnd() * 0.5;
    const steps = 20000;
    let want = 0;
    for (let k = 0; k < steps; k++) {
      const s = ((k + 0.5) / steps) * D;
      const p: Vec3 = [o[0] + dir[0] * s, o[1] + dir[1] * s, o[2] + dir[2] * s];
      const d2 = (p[0] - lamp[0]) ** 2 + (p[1] - lamp[1]) ** 2 + (p[2] - lamp[2]) ** 2;
      want += (D / steps) / (d2 + eps * eps);
    }
    worst = Math.max(worst, Math.abs(lampIntegral(o, dir, D, lamp, eps) - want) / want);
  }
  ok(worst < 1e-4, `the lamp integral matches numeric integration within 1e-4 over 100 cases (${worst.toExponential(1)})`);
}

// ---- 9. The phase function averages 1 over the sphere ----
{
  const steps = 200000;
  let sum = 0;
  for (let k = 0; k < steps; k++) {
    const mu = -1 + ((k + 0.5) / steps) * 2;
    sum += phaseHG(mu, 0.35) * (2 / steps);
  }
  const total = 2 * Math.PI * sum;
  ok(near(total / (4 * Math.PI), 1, 0.01), `Henyey-Greenstein at g 0.35 integrates to 4 pi (${(total / (4 * Math.PI)).toFixed(5)} x)`);
  ok(phaseHG(1, 0.35) > phaseHG(-1, 0.35), 'and is brightest looking towards the light');
}

// ---- 10. Where a mote is drawn ----
{
  const rnd = mulberry32(10);
  const span = 8;
  const seeds: Vec3[] = [];
  for (let k = 0; k < 500; k++) seeds.push([rnd() * span * 3 - span, rnd() * span * 3 - span, rnd() * span * 3 - span]);
  const cam: Vec3 = [1.3, -2.7, 40.2];
  const at = seeds.map((p) => moteWrap(p, cam, span));
  ok(at.every((p) => p.every((x, k) => Math.abs(x - cam[k]) <= span / 2 + 1e-9)), 'every mote is drawn within half a span of the camera on each axis');
  let same = true;
  for (let axis = 0; axis < 3; axis++) {
    const c2: Vec3 = [...cam];
    c2[axis] += span;
    const moved = seeds.map((p) => moteWrap(p, c2, span));
    // The same copy of the lattice a span on: every mote where it was relative to the camera.
    if (!moved.every((p, i) => near(p[0] - c2[0], at[i][0] - cam[0], 1e-9) && near(p[1] - c2[1], at[i][1] - cam[1], 1e-9) && near(p[2] - c2[2], at[i][2] - cam[2], 1e-9))) same = false;
  }
  ok(same, 'moving the camera a whole span shows the same motes in the same places around it (the pattern tiles)');
  const c3: Vec3 = [cam[0] + 0.1, cam[1], cam[2]];
  const moved = seeds.map((p) => moteWrap(p, c3, span));
  let onlyCrossing = true;
  let crossed = 0;
  for (let i = 0; i < seeds.length; i++) {
    if (dist(moved[i], at[i]) < 1e-9) continue;
    crossed++;
    // Only those that fell off the trailing edge moved, and by exactly a span.
    if (!(at[i][0] - cam[0] < -span / 2 + 0.1 + 1e-9 && near(moved[i][0] - at[i][0], span, 1e-9))) onlyCrossing = false;
  }
  ok(onlyCrossing, `moving it 10 cm moves only the motes crossing the tile's edge (${crossed} of ${seeds.length})`);
}

// ---- 11. Sun samples on an arch and on a concave doorway ----
{
  const arch: Vec3[] = [
    [-1.79, 6.06, 0],
    [-1.03, 6.82, 0],
    [0, 7.09, 0],
    [1.03, 6.82, 0],
    [1.79, 6.06, 0],
    [2.06, 5.03, 0],
    [2.06, 2.28, 0],
    [-2.06, 2.28, 0],
    [-2.06, 5.03, 0],
  ];
  const fan: number[] = [];
  for (let k = 1; k + 1 < arch.length; k++) fan.push(0, k, k + 1);
  const s = apertureSamples(arch, fan, 5, 0.3);
  ok(s.length === 5 && s.every((p) => inTriangles(p, arch, fan)), 'on a nine-vertex arch every sample lies inside its triangles');
  ok(minPair(s) >= 0.3, `and no two are closer than 0.3 m (${minPair(s).toFixed(3)})`);
  // An L: a 3 x 3 square with its upper right 2 x 2 taken out.
  const L: Vec3[] = [
    [0, 0, 0],
    [3, 0, 0],
    [3, 1, 0],
    [1, 1, 0],
    [1, 3, 0],
    [0, 3, 0],
  ];
  const Lt = [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5];
  const sl = apertureSamples(L, Lt, 5, 0.3);
  ok(sl.length === 5 && sl.every((p) => inTriangles(p, L, Lt)), 'on a concave L-shaped doorway every sample lies inside its own triangles');
  ok(sl.every((p) => !(p[0] > 1 && p[1] > 1)), 'and none in the notch');
}

// ---- 12. Lamps kept inside their rooms ----
{
  const b: RoomBox = { min: [0, 0, 0], max: [4, 3, 5] };
  const shrunk = shrinkBox(b, 0.2);
  const c = clampToBox([2, 4, 2], shrunk);
  ok(nearV(c, [2, 2.8, 2], 1e-12), 'a lamp 1 m above a 3 m room clamps to 0.2 m under its top');
  const thin = shrinkBox({ min: [0, 0, 0], max: [4, 0.3, 5] }, 0.2);
  ok(near(thin.min[1], 0.15, 1e-12) && near(thin.max[1], 0.15, 1e-12) && near(clampToBox([1, 5, 1], thin)[1], 0.15, 1e-12), 'an axis 0.3 m thick clamps to its middle');
}

// ---- 13. A mote's sprite lights its pixels evenly wherever it sits ----
{
  let lo = Infinity;
  let hi = -Infinity;
  for (let size = 3.5; size <= 12 + 1e-9; size += 0.125) {
    for (let i = 0; i < 32; i++) {
      for (let j = 0; j < 32; j++) {
        const r = moteSpriteSum(size, (i + 0.5) / 32, (j + 0.5) / 32) / ((Math.PI / 16) * size * size);
        lo = Math.min(lo, r);
        hi = Math.max(hi, r);
      }
    }
  }
  ok(lo >= 0.94 && hi <= 1.0, `drawn at 3.5 to 12 px the sprite's energy stays within 0.94 to 1.00 of its integral (${lo.toFixed(4)} to ${hi.toFixed(4)})`);
  ok(hi / lo <= 1.06, `and swings at most 6% as it crosses pixels (${((hi / lo - 1) * 100).toFixed(2)}%)`);
  let small = Infinity;
  let smallHi = -Infinity;
  for (let i = 0; i < 32; i++) {
    for (let j = 0; j < 32; j++) {
      const r = moteSpriteSum(1.5, (i + 0.5) / 32, (j + 0.5) / 32) / ((Math.PI / 16) * 1.5 * 1.5);
      small = Math.min(small, r);
      smallHi = Math.max(smallHi, r);
    }
  }
  ok(smallHi / small > 4, `(at 1.5 px it would swing ${(smallHi / small).toFixed(1)}x, which is why it is never drawn that small)`);
}

// ---- The settings reader ----
{
  const out: RoomAirSettings = { ...ROOM_AIR_SETTING_DEFAULTS };
  readRoomAirSettings({ effects: false, lightShaftStrength: 1.2, roomMotes: 'yes' }, out);
  ok(out.effects === false && out.lightShaftStrength === 1.2 && out.roomMotes === true && out.roomGlowStrength === 0.5, 'a settings key the registry does not carry, or of the wrong type, takes its default');
}

// ---- Neighbours ----
{
  const def: RoomModelDef = {
    cells: [
      { index: 0, bounds: BOX, portals: [{ geometry: 0, target: 1 }] },
      { index: 1, bounds: BOX, portals: [{ geometry: 0, target: 0 }, { geometry: 1, target: 2 }] },
      { index: 2, bounds: BOX, portals: [{ geometry: 1, target: 1 }, { geometry: 2, target: 3 }] },
      { index: 3, bounds: BOX, portals: [] },
    ],
  };
  ok(JSON.stringify(neighbourCells(def, 2)) === '[1,3]' && JSON.stringify(neighbourCells(def, 3)) === '[2]' && JSON.stringify(neighbourCells(def, 1)) === '[2]', 'a room\'s neighbours are the rooms either side of its portals, never the shell');
  ok(cellBoxes(def).size === 3 && !cellBoxes(def).has(0), 'every room has a box, the shell none');
}

// ---- 14. The real packs, when they are here ----
{
  const root = new URL('../../../assets-private/', import.meta.url);
  if (!existsSync(new URL('tatooine/manifest.json', root))) {
    console.log('skip the converted packs are not here (assets-private/tatooine/manifest.json)');
  } else {
    type PackDef = RoomModelDef & { id: string };
    for (const pack of ['tatooine', 'naboo', 'corellia', 'mustafar']) {
      const url = new URL(`${pack}/manifest.json`, root);
      if (!existsSync(url)) {
        console.log(`skip ${pack}: not converted`);
        continue;
      }
      const manifest = JSON.parse(readFileSync(url, 'utf8')) as { categories: Record<string, PackDef[]> };
      let buildings = 0;
      let exits = 0;
      let apertures = 0;
      let finite = true;
      let probesAgree = true;
      let centreDecided = 0;
      let vertsInside = true;
      let samplesInside = true;
      let lamps = 0;
      let moved = 0;
      let lampsInside = true;
      const seen = new Set<string>();
      for (const list of Object.values(manifest.categories)) {
        for (const def of list) {
          if (!def.cells?.length || !def.portals?.length || seen.has(def.id)) continue;
          seen.add(def.id);
          const counted = new Set<number>();
          for (const c of def.cells) if (c.index > 0) for (const p of c.portals ?? []) if (p.target === 0) counted.add(p.geometry);
          if (!counted.size) continue;
          buildings++;
          exits += counted.size;
          const ap = exitApertures(def);
          apertures += ap.length;
          const allBoxes = [...cellBoxes(def).values()];
          for (const a of ap) {
            const nums = [...a.origin, ...a.u, ...a.v, ...a.inward, a.width, a.height, a.area, ...a.shaftBox.min, ...a.shaftBox.max, ...a.samples.flat()];
            if (!nums.every(Number.isFinite) || a.width < 0.2 || a.height < 0.2) finite = false;
            if (a.decidedBy === 'probes') {
              // Not the probes again: steps of 0.5, 1 and 2 m either way against every room of the
              // building. Out of a doorway onto the world is where the rooms end.
              let into = 0;
              let out = 0;
              for (const s of [0.5, 1, 2]) {
                for (const b of allBoxes) {
                  if (inside([a.centroid[0] + a.inward[0] * s, a.centroid[1] + a.inward[1] * s, a.centroid[2] + a.inward[2] * s], b)) into++;
                  if (inside([a.centroid[0] - a.inward[0] * s, a.centroid[1] - a.inward[1] * s, a.centroid[2] - a.inward[2] * s], b)) out++;
                }
              }
              if (!(out < into)) probesAgree = false;
            } else centreDecided++;
            if (!a.verts.every((p) => inside(p, a.shaftBox, 1e-9))) vertsInside = false;
            if (!a.samples.every((p) => inTriangles(p, a.verts, a.tris, 1e-6))) samplesInside = false;
          }
          const boxes = cellBoxes(def);
          for (const c of def.cells as { index: number; lights?: { type: number; position: number[] }[] }[]) {
            const box = boxes.get(c.index);
            if (!box) continue;
            const shrunk = shrinkBox(box, 0.2);
            for (const l of c.lights ?? []) {
              if (l.type !== 2) continue;
              lamps++;
              const p: Vec3 = [l.position[0], l.position[1], l.position[2]];
              const q = clampToBox(p, shrunk);
              if (dist(p, q) > 1e-9) moved++;
              if (!inside(q, shrunk, 1e-9)) lampsInside = false;
            }
          }
        }
      }
      console.log(`     ${pack}: ${buildings} buildings, ${exits} exits, ${apertures} doorways cast beams (${centreDecided} decided by the box's centre), ${lamps} point lights (${moved} moved into their room)`);
      ok(finite, `${pack}: every doorway's numbers are finite, at least 0.2 m wide and high`);
      ok(probesAgree, `${pack}: wherever the probes decide, steps out of the doorway land in fewer of the building's rooms than steps in`);
      ok(vertsInside, `${pack}: every exit vertex lies inside its shaft box`);
      ok(samplesInside, `${pack}: every sun sample lies inside its doorway's own triangles`);
      ok(lampsInside, `${pack}: every point light, clamped, lies inside its room's shrunk box`);
    }
  }
}

// ---- 15. The shader's noise is the noise pinned here ----
{
  const src = readFileSync(new URL('../../../src/core/fx/lightShafts.ts', import.meta.url), 'utf8');
  const literal = /[^\w.](1\.7|4\.3)[^\d]/.test(src.replace(/\/\/.*$/gm, ''));
  ok(/NOISE_FREQ\[0\]/.test(src) && /NOISE_FREQ\[1\]/.test(src) && !literal, `the haze shader takes its streak frequencies from NOISE_FREQ (${NOISE_FREQ.join(', ')}), with no literal copy`);
}

// ---- 16. RoomAir, frame by frame ----
{
  // The portal renderer's module carries a parameter property, which node's type stripping refuses;
  // RoomAir takes only its layer and markActor from it, so those are served from a stub with the
  // real layer number read from its source.
  const portalSrc = readFileSync(new URL('../../../src/world/portalRender.ts', import.meta.url), 'utf8');
  const layer = Number(/export const ACTOR_LAYER = (\d+);/.exec(portalSrc)?.[1]);
  ok(Number.isInteger(layer) && layer > 0 && layer < 32, `the actor layer is read from portalRender.ts (${layer})`);
  const stub = `export const ACTOR_LAYER = ${layer}; export function markActor(o) { o.traverse((x) => x.layers.enable(${layer})); }`;
  const hook = `export async function resolve(s, c, next) { if (s.endsWith('/portalRender.ts')) return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(stub)}), shortCircuit: true }; return next(s, c); }`;
  register('data:text/javascript,' + encodeURIComponent(hook));
  const { RoomAir, HOLD_SECONDS, LAMP_INSET, ROOM_AIR_TUNING } = await import('../../../src/world/roomAir.ts');
  const { resetFxLights, setDirectional, addPointLight } = await import('../../../src/core/fx/lights.ts');
  type Air = InstanceType<typeof RoomAir>;

  const dt = 1 / 60;
  // Two rooms: the foyer (0, 0, 0)-(4, 3, 5) with a door onto the street on z = 0 and a window onto
  // it on x = 0, and the hall (0, 0, 5)-(4, 3, 12) behind it through an inner door on z = 5.
  const def = {
    id: 'test_house',
    cells: [
      { index: 0, name: 'r0', bounds: { min: [-10, -10, -10], max: [10, 10, 20] }, portals: [{ geometry: 0, target: 1 }, { geometry: 2, target: 1 }] },
      { index: 1, name: 'foyer', bounds: { min: [0, 0, 0], max: [4, 3, 5] }, portals: [{ geometry: 0, target: 0 }, { geometry: 1, target: 2 }, { geometry: 2, target: 0 }] },
      { index: 2, name: 'hall', bounds: { min: [0, 0, 5], max: [4, 3, 12] }, portals: [{ geometry: 1, target: 1 }] },
    ],
    portals: [
      { v: DOOR, i: CCW },
      { v: DOOR.map((p) => [p[0], p[1], 5]), i: CCW },
      { v: [[0, 1, 2], [0, 1, 3.5], [0, 2, 3.5], [0, 2, 2]], i: CCW },
    ],
  };
  const building = { model: { def }, matrix: new THREE.Matrix4(), inverse: new THREE.Matrix4() };
  const boxOf = (cell: number) => shrinkBox(normaliseBox(def.cells[cell].bounds), LAMP_INSET);

  // A wall between the rooms at z = 5, open only in the inner door (x 1 to 2, up to 2.2 m).
  const crossesWall = (a: THREE.Vector3, b: THREE.Vector3) => {
    if ((a.z - 5) * (b.z - 5) >= 0) return false;
    const t = (5 - a.z) / (b.z - a.z);
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    return !(x >= 1 && x <= 2 && y >= 0 && y <= 2.2);
  };

  function rig(opts: { shaded?: (from: THREE.Vector3) => boolean; settings?: Record<string, unknown> } = {}) {
    const scene = new THREE.Scene();
    // The world's pooled room lamps: their world matrices move only when the scene is drawn.
    const pool = [0, 1, 2].map(() => new THREE.PointLight(0xffffff, 0, 1, 2));
    const poolCell = [-1, -1, -1];
    for (const l of pool) scene.add(l);
    const sun = new THREE.DirectionalLight(0xfff0dd, 2.5);
    const towardSun = new THREE.Vector3(-0.4, 0.5, -0.77).normalize();
    sun.position.copy(towardSun).multiplyScalar(50);
    scene.add(sun, sun.target);
    scene.updateMatrixWorld(true);
    const counts = { outdoor: 0, segment: 0 };
    let litCell = 0;
    const world = {
      physics: {
        outdoorBlocked: (from: THREE.Vector3) => {
          counts.outdoor++;
          return opts.shaded ? opts.shaded(from) : false;
        },
        segmentBlocked: (a: THREE.Vector3, b: THREE.Vector3) => {
          counts.segment++;
          return crossesWall(a, b);
        },
      },
      day: {},
      // As World.fillFxLights: the sun from its light, the lit cell's lamps from their world matrices.
      fillFxLights(o: Parameters<typeof resetFxLights>[0]) {
        resetFxLights(o);
        setDirectional(o.sky.sun, sun);
        if (!litCell) return;
        const r = o.rooms;
        r.lit = true;
        r.building = building as never;
        r.cell = litCell;
        r.ambient.setRGB(0.2, 0.18, 0.15);
        for (let i = 0; i < pool.length; i++) r.pointCount = addPointLight(r.points, r.pointCount, pool[i], poolCell[i]);
      },
    };
    // As World.updateInteriorLights: positions and intensities, no matrix.
    const lightCell = (cell: number, lamps: [number, number, number, number][]) => {
      litCell = cell;
      lamps.forEach(([x, y, z, c], i) => {
        pool[i].position.set(x, y, z);
        pool[i].intensity = 3;
        pool[i].distance = 12;
        poolCell[i] = c;
      });
    };
    const portals = { registerMaterial() {}, forget() {} };
    const air: Air = new RoomAir(scene, world as never, portals as never, (opts.settings ?? {}) as never);
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 9000);
    const input = {
      dt,
      camera,
      view: building as unknown,
      cell: { building, cell: 1 } as unknown,
      aboard: null as unknown,
      cameraInHull: false,
      playerPos: new THREE.Vector3(),
      sun: { dir: towardSun.clone(), color: new THREE.Color(1, 0.94, 0.87), intensity: 1 },
      overcast: 0,
      dust: 0,
      bufferHeight: 1080,
    };
    const place = (x: number, y: number, z: number, lx: number, ly: number, lz: number) => {
      camera.position.set(x, y, z);
      camera.lookAt(lx, ly, lz);
      camera.updateMatrixWorld();
      input.playerPos.set(x, 0, z);
    };
    // One frame: RoomAir before the scene is drawn, then the draw brings every matrix up to date.
    const frame = () => {
      air.update(input as never);
      scene.updateMatrixWorld();
      return air.frame;
    };
    return { air, scene, pool, input, counts, lightCell, place, frame };
  }

  const FOYER_LAMPS: [number, number, number, number][] = [
    [2, 2.5, 2, 1], // in the foyer, in sight
    [3.5, 1.5, 9, 2], // in the hall, behind the wall
    [1.5, 3.6, 3, 1], // in the foyer's ceiling, above its box
  ];
  const HALL_LAMPS: [number, number, number, number][] = [
    [2, 2.5, 9, 2],
    [3, 2.5, 11, 2],
    [3.5, 1.5, 2, 1], // back in the foyer, behind the wall from the hall
  ];

  // -- The hold and the fade --
  const r = rig();
  r.lightCell(1, FOYER_LAMPS);
  r.place(3.5, 1.6, 1, 2, 1.6, 4);
  let expectFirst = 0;
  for (let acc = 0; acc < HOLD_SECONDS; acc += dt) expectFirst++;
  let first = -1;
  let lastFade = 0;
  let fadeMonotone = true;
  for (let k = 0; k < 60; k++) {
    const f = r.frame();
    if (f && first < 0) first = k;
    if (f) {
      if (f.fade < lastFade) fadeMonotone = false;
      lastFade = f.fade;
    }
  }
  ok(first === expectFirst - 1, `the room shows only once it has held for ${HOLD_SECONDS} s (frame ${first}, the ${expectFirst}th at 60 Hz)`);
  ok(fadeMonotone && lastFade === 1, 'and fades in without a step back, to 1 within a second');
  ok(r.air.points.visible && r.air.points.geometry.drawRange.count === ROOM_AIR_TUNING.moteCount, `the motes are drawn, ${ROOM_AIR_TUNING.moteCount} of them at amount 1`);
  ok(r.air.points.layers.isEnabled(layer) && !r.air.points.layers.isEnabled(0), 'on the actor layer alone');
  let f = r.air.frame!;
  ok(f.moteBoxCount === 2 && f.moteBoxMin[0].z === 0 && f.moteBoxMax[0].z === 5 && f.moteBoxMin[1].z === 5, 'they fill the foyer and the hall it opens onto');

  // -- The beams --
  let d = r.air.describe();
  const slotOf = (portal: number) => d.shafts.find((s) => s.portal === portal)?.slot ?? -1;
  ok(d.shafts.length === 2 && d.shafts.every((s) => s.lit === 1 && s.weight === 1 && s.facing === 1), 'both the door and the window face the sun and are lit: two beams at full weight');
  ok(d.shafts.every((s) => s.decidedBy === 'probes') && f.shaftsLit && f.shaftCount === 2, 'the frame carries both');
  const doorSlot = slotOf(0);
  const windowSlot = slotOf(2);
  let outdoorPerFrame = 0;
  let stable = true;
  for (let k = 0; k < 120; k++) {
    const before = r.counts.outdoor;
    r.frame();
    outdoorPerFrame = Math.max(outdoorPerFrame, r.counts.outdoor - before);
    d = r.air.describe();
    if (slotOf(0) !== doorSlot || slotOf(2) !== windowSlot) stable = false;
  }
  ok(stable, `each doorway keeps its slot through eight selections (door ${doorSlot}, window ${windowSlot})`);
  ok(outdoorPerFrame <= 5, `at most one doorway's five sun rays are cast in a frame once they are tested (${outdoorPerFrame})`);

  // -- The lamps, in the foyer --
  f = r.air.frame!;
  ok(f.lampCount === 3 && f.lampSightCount === 2, `three lamps, two in sight (${f.lampCount}, ${f.lampSightCount})`);
  const at = (j: number) => [f.lampPos[j].x, f.lampPos[j].y, f.lampPos[j].z].map((v) => Number(v.toFixed(3)));
  ok(JSON.stringify([at(0), at(1)]) === JSON.stringify([[2, 2.5, 2], [1.5, 3 - LAMP_INSET, 3]]), `those in sight first, the ceiling lamp kept ${LAMP_INSET} m under the foyer's top (${JSON.stringify([at(0), at(1)])})`);
  ok(JSON.stringify(at(2)) === JSON.stringify([3.5, 1.5, 9]) && f.lampColor[2].w === 0 && f.lampColor[0].w === 1, 'the hall lamp behind the wall last, with no sight');
  let segPerFrame = 0;
  let segMin = Infinity;
  for (let k = 0; k < 30; k++) {
    const before = r.counts.segment;
    r.frame();
    segPerFrame = Math.max(segPerFrame, r.counts.segment - before);
    segMin = Math.min(segMin, r.counts.segment - before);
  }
  ok(segPerFrame === 1 && segMin === 1, 'once they are known, one lamp\'s sight is tested a frame');

  // -- The door line --
  r.input.view = null;
  const flip = r.frame();
  const flipMotes = r.air.points.visible;
  r.input.view = building;
  const back = r.frame();
  ok(flip === null && !flipMotes, 'a frame the portal renderer draws from outside shows nothing, motes included');
  ok(back !== null && back.fade === 1 && r.air.points.visible, 'and a one-frame flip on the door line does not restart the fade');

  // -- Into the hall: the world moves its lamps by position, and their matrices follow at the draw --
  const beforePos = Array.from({ length: f.lampCount }, (_, j) => f.lampPos[j].toArray());
  const beforeColor = Array.from({ length: f.lampCount }, (_, j) => f.lampColor[j].toArray());
  r.input.cell = { building, cell: 2 };
  r.place(2.5, 1.6, 8, 2.5, 1.6, 11);
  r.lightCell(2, HALL_LAMPS);
  r.air.update(r.input as never); // no draw yet: the lamps' matrices are last frame's
  f = r.air.frame!;
  const keptPos = Array.from({ length: f.lampCount }, (_, j) => f.lampPos[j].toArray());
  const keptColor = Array.from({ length: f.lampCount }, (_, j) => f.lampColor[j].toArray());
  ok(f.lampCount === beforePos.length && JSON.stringify(keptPos) === JSON.stringify(beforePos) && JSON.stringify(keptColor) === JSON.stringify(beforeColor), 'on the frame the lit room changes, last frame\'s lamps stand: none is read from a matrix the draw has not moved yet');
  r.scene.updateMatrixWorld();
  const seg0 = r.counts.segment;
  r.frame();
  f = r.air.frame!;
  ok(r.counts.segment - seg0 === 3, `the next frame reads each lamp as new and tests its sight at once (${r.counts.segment - seg0} rays)`);
  ok(f.lampCount === 3 && f.lampSightCount === 2, `in the hall: three lamps, two in sight (${f.lampCount}, ${f.lampSightCount})`);
  ok(JSON.stringify([at(0), at(1), at(2)]) === JSON.stringify([[2, 2.5, 9], [3, 2.5, 11], [3.5, 1.5, 2]]) && f.lampColor[2].w === 0, 'at their own places: the hall\'s two in sight, the foyer lamp behind the wall without');
  const hallBox = boxOf(2);
  ok(inside([f.lampPos[0].x, f.lampPos[0].y, f.lampPos[0].z], hallBox) && inside([f.lampPos[1].x, f.lampPos[1].y, f.lampPos[1].z], hallBox), 'inside the hall\'s shrunk box');
  ok(f.moteBoxCount === 2 && f.moteBoxMin[0].z === 5 && f.moteBoxMax[1].z === 5, 'the motes follow into the hall and the foyer it opens onto');
  ok(r.air.describe().shafts.length === 2, 'the street doorways still cast their beams, seen from the hall');

  // -- Shade --
  r.input.cell = { building, cell: 1 };
  r.place(3.5, 1.6, 1, 2, 1.6, 4);
  r.lightCell(1, FOYER_LAMPS);
  for (let k = 0; k < 10; k++) r.frame();
  const shaded = rig({ shaded: (from) => from.x < 0 });
  shaded.lightCell(1, FOYER_LAMPS);
  shaded.place(3.5, 1.6, 1, 2, 1.6, 4);
  let windowFlash = 0;
  for (let k = 0; k < 90; k++) {
    shaded.frame();
    const dd = shaded.air.describe();
    const w = dd.shafts.find((s) => s.portal === 2);
    if (w && shaded.air.frame) windowFlash = Math.max(windowFlash, shaded.air.frame.shaftLight[w.slot].w);
  }
  const dd = shaded.air.describe();
  ok(windowFlash === 0 && dd.shafts.length === 1 && dd.shafts[0].portal === 0, 'a window shaded outside never flashes a beam: it is tested before it is ever drawn');
  // The door goes into shade: its beam fades out and its slot is freed.
  let dimDoor = false;
  const dim = rig({ shaded: (from) => from.x < 0 || dimDoor });
  dim.lightCell(1, FOYER_LAMPS);
  dim.place(3.5, 1.6, 1, 2, 1.6, 4);
  for (let k = 0; k < 60; k++) dim.frame();
  const doorSlotBefore = dim.air.describe().shafts.find((s) => s.portal === 0)?.slot;
  dimDoor = true;
  let freed = -1;
  for (let k = 0; k < 240 && freed < 0; k++) {
    dim.frame();
    if (!dim.air.describe().shafts.some((s) => s.portal === 0)) freed = k;
  }
  ok(doorSlotBefore !== undefined && freed > 0 && freed <= 150, `a door the sun stops reaching fades out and gives up its slot (${((freed + 1) * dt).toFixed(2)} s)`);
  ok(dim.air.frame !== null && !dim.air.frame.shaftsLit && dim.air.frame.shaftLight.every((l) => l.w === 0), 'and nothing is lit after');

  // -- Leaving --
  r.input.view = null;
  r.input.cell = { building, cell: 0 };
  let gone = -1;
  let shownOutside = false;
  for (let k = 0; k < 90; k++) {
    if (r.frame()) shownOutside = true;
    if (gone < 0 && r.air.describe().mode === null) gone = k;
  }
  ok(!shownOutside && gone > 0 && (gone + 1) * dt <= HOLD_SECONDS + 1 / ROOM_AIR_TUNING.fadeRate + 2 * dt, `outside nothing is drawn, and the room lets go after the hold and the fade (${((gone + 1) * dt).toFixed(2)} s)`);
  r.input.view = building;
  r.input.cell = { building, cell: 1 };
  let again = -1;
  for (let k = 0; k < 30 && again < 0; k++) if (r.frame()) again = k;
  ok(again === expectFirst - 1 && r.air.frame!.fade < 0.1, 'coming back in, the room starts from nothing again');

  // -- Everything off --
  const off = rig({ settings: { effects: false, roomMotes: false } });
  off.lightCell(1, FOYER_LAMPS);
  off.place(3.5, 1.6, 1, 2, 1.6, 4);
  let anyOff = false;
  for (let k = 0; k < 60; k++) if (off.frame() || off.air.points.visible) anyOff = true;
  ok(!anyOff && off.counts.outdoor === 0 && off.counts.segment === 0, 'with the effects and the motes off nothing is drawn and no ray is cast');

  // -- Motes alone, with the effects off --
  const motes = rig({ settings: { effects: false } });
  motes.lightCell(1, FOYER_LAMPS);
  motes.place(3.5, 1.6, 1, 2, 1.6, 4);
  for (let k = 0; k < 60; k++) motes.frame();
  ok(motes.air.frame !== null && motes.air.points.visible, 'with the effects off the motes are still drawn');

  // -- Aboard a ship --
  {
    const s = rig();
    const group = new THREE.Object3D();
    group.position.set(100, 5, 50);
    group.rotation.set(0, 0.4, 0.7);
    group.updateMatrixWorld(true);
    const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
    const boxes = new Map([
      [1, box(-2, 0, -4, 2, 2.5, 0)],
      [2, box(-2, 0, 0, 2, 2.5, 6)],
    ]);
    const lamp = (x: number, y: number, z: number, cell: number) => ({ pos: new THREE.Vector3(x, y, z), color: 0xaaccff, intensity: 2, distance: 8, cell });
    const ship = {
      vehicle: { group, spec: { label: 'test ship' } },
      lights: [lamp(0, 2.2, -2, 1), lamp(0, 2.2, 1, 2), lamp(0, 2.2, 3, 2), lamp(0, 2.2, 5.5, 2)],
      cellBox: (i: number) => boxes.get(i) ?? null,
      neighbourCells: (i: number) => (i === 1 ? [2] : [1]),
      cellAt: (p: THREE.Vector3) => {
        for (const [i, b] of boxes) if (b.containsPoint(p)) return i;
        return 0;
      },
      physics: { segmentBlocked: () => false },
      bounds: box(-2, 0, -4, 2, 2.5, 6),
    };
    const local = new THREE.Vector3(0, 1.6, -1);
    s.input.view = null;
    s.input.cell = null;
    s.input.aboard = ship;
    s.input.cameraInHull = true;
    s.input.playerPos.set(0, 0, -1);
    s.input.camera.position.copy(local).applyMatrix4(group.matrixWorld);
    s.input.camera.updateMatrixWorld();
    for (let k = 0; k < 60; k++) s.frame();
    const sf = s.air.frame!;
    ok(sf !== null && sf.mode === 'ship' && sf.shaftCount === 0, 'aboard, the rooms of the ship are the room: no beams');
    ok(sf.cameraRoom.distanceTo(local) < 1e-6, 'the camera is placed in the hull\'s frame');
    const picked = Array.from({ length: sf.lampCount }, (_, j) => Number(sf.lampPos[j].z.toFixed(2))).sort((a, b) => a - b);
    ok(sf.lampCount === 3 && JSON.stringify(picked) === JSON.stringify([-2, 1, 3]), `the three lamps nearest the player glow, as the flash pool lights them (${JSON.stringify(picked)})`);
    ok(sf.moteBoxCount === 2, 'the motes fill the player\'s room and the one it opens onto');
    s.input.cameraInHull = false;
    ok(s.frame() === null && !s.air.points.visible, 'and the moment the camera leaves the rooms, nothing is drawn');
  }
}

console.log(`\n${passed} passed`);
