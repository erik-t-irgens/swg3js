// Wave 3 of the animations: the two-bone solve (src/anim/twoBone.ts) the feet's placement bends the legs by and the hands'
// bracing will bend the arms by. Over thousands of limbs of every proportion and pose and targets near and far: the end
// meets the target within a millimetre wherever the limb can reach it (and stops short along the line where it cannot),
// the bones keep their lengths (never stretched, never folded past their overlap), the middle joint bends the way the pose
// bends it (its offset from its own line, root to end, leaning as the posed knee's leans from the posed line: a knee never
// bends backward) and stays in the plane through the root, the target and that bend; a nearly straight leg whose target
// moves forward, back, up, down and aside keeps its knee ahead and in the pose's own plane (off it by no more than the
// target is); a target at the posed end hands back the posed middle joint, and a straight posed limb bends to the
// caller's pole. Then each rule broken in a copy of the file, each failing its check.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

type Mod = typeof import('../../../src/anim/twoBone.ts');
const SRC = readFileSync(join(REPO, 'src/anim/twoBone.ts'), 'utf8').replace(/\r\n/g, '\n');
async function load(text: string): Promise<Mod> {
  const dir = mkdtempSync(join(tmpdir(), 'twobone-'));
  try {
    const f = join(dir, 'twoBone.ts');
    writeFileSync(f, text);
    return (await import(pathToFileURL(f).href)) as Mod;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A seeded random, so every run asks the same limbs. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V) => Math.sqrt(dot(a, a));
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** A point's offset from the line through `a` and `c` (the part of `p - a` across the line). */
const offLine = (a: V, c: V, p: V): V => {
  const u = sub(c, a);
  const ul = len(u);
  const w = sub(p, a);
  const pr = dot(w, u) / (ul * ul);
  return [w[0] - u[0] * pr, w[1] - u[1] * pr, w[2] - u[2] * pr];
};

interface Verdict {
  reachedWorst: number;
  lengthWorst: number;
  planeWorst: number;
  backward: number;
  shortWrong: number;
  identityWorst: number;
  poleWrong: number;
  overStretched: number;
}

function measure(m: Mod): Verdict {
  const r = rng(7);
  const q = new m.TwoBoneAsk();
  const o = new m.TwoBoneOut();
  const v: Verdict = { reachedWorst: 0, lengthWorst: 0, planeWorst: 0, backward: 0, shortWrong: 0, identityWorst: 0, poleWrong: 0, overStretched: 0 };
  for (let i = 0; i < 4000; i++) {
    const l1 = 0.15 + r() * 0.5;
    const l2 = 0.15 + r() * 0.5;
    const a: V = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1];
    // A posed limb bent by a random angle about a random hinge.
    const d1n: V = [r() - 0.5, r() - 0.5, r() - 0.5];
    const d1 = d1n.map((x) => (x / len(d1n)) * l1) as V;
    const b: V = [a[0] + d1[0], a[1] + d1[1], a[2] + d1[2]];
    let axis = cross(d1, [r() - 0.5, r() - 0.5, r() - 0.5]);
    axis = axis.map((x) => x / len(axis)) as V;
    const bend = 0.2 + r() * 2.4;
    // Rodrigues: the second bone the first's direction turned by `bend` about `axis`.
    const u = d1.map((x) => x / l1) as V;
    const c1 = Math.cos(bend), s1 = Math.sin(bend);
    const kxu = cross(axis, u);
    const d2u = [0, 1, 2].map((k) => u[k] * c1 + kxu[k] * s1 + axis[k] * dot(axis, u) * (1 - c1)) as V;
    const c: V = [b[0] + d2u[0] * l2, b[1] + d2u[1] * l2, b[2] + d2u[2] * l2];
    // A target near, far or out of reach.
    const reach = (r() * 1.3) * (l1 + l2);
    const tn: V = [r() - 0.5, r() - 0.5, r() - 0.5];
    const t: V = [a[0] + (tn[0] / len(tn)) * reach, a[1] + (tn[1] / len(tn)) * reach, a[2] + (tn[2] / len(tn)) * reach];
    Object.assign(q, { ax: a[0], ay: a[1], az: a[2], bx: b[0], by: b[1], bz: b[2], cx: c[0], cy: c[1], cz: c[2], tx: t[0], ty: t[1], tz: t[2], px: 0, py: 0, pz: 1 });
    m.solveTwoBone(q, o);
    const k: V = [o.kx, o.ky, o.kz];
    const e: V = [o.ex, o.ey, o.ez];
    const nl1 = len(sub(k, a));
    const nl2 = len(sub(e, k));
    v.lengthWorst = Math.max(v.lengthWorst, Math.abs(nl1 - l1), Math.abs(nl2 - l2));
    const dl = len(sub(t, a));
    const inReach = dl <= l1 + l2 - 1e-3 && dl >= Math.abs(l1 - l2) + 1e-3;
    if (inReach) v.reachedWorst = Math.max(v.reachedWorst, len(sub(e, t)));
    else {
      // Short of it along the line: the end on the line from the root to the target.
      const along = sub(e, a);
      const dir = sub(t, a).map((x) => x / dl) as V;
      const off = len(cross(along, dir));
      if (off > 1e-6) v.shortWrong++;
    }
    if (len(sub(e, a)) > l1 + l2 + 1e-9) v.overStretched++;
    // The pose's own bend: the posed knee's offset from the posed limb's line, root to posed end.
    const w0 = offLine(a, c, b);
    // The plane through the root, the target and that bend (the pose's pole turned onto the new reach); and the side:
    // the solved knee's offset from its own line, root to end, leaning the way the pose's does (never backward).
    const n = cross(sub(t, a), w0);
    if (len(n) > 1e-6 && len(sub(e, a)) > 1e-6) {
      const nu = n.map((x) => x / len(n)) as V;
      v.planeWorst = Math.max(v.planeWorst, Math.abs(dot(sub(k, a), nu)));
      if (dot(offLine(a, e, k), w0) < -1e-12) v.backward++;
    }
    // Asked for the posed end itself: the posed knee.
    Object.assign(q, { tx: c[0], ty: c[1], tz: c[2] });
    m.solveTwoBone(q, o);
    v.identityWorst = Math.max(v.identityWorst, len(sub([o.kx, o.ky, o.kz], b)), len(sub([o.ex, o.ey, o.ez], c)));
  }
  // A straight posed limb (straight to within a fraction of a degree, its knee a millimetre or two off the line every
  // way): no side of its own worth reading, so the caller's pole says it.
  for (let i = 0; i < 200; i++) {
    const pole: V = [r() - 0.5, r() - 0.5, r() - 0.5];
    const jx = (r() - 0.5) * 0.004;
    const jz = (r() - 0.5) * 0.004;
    Object.assign(q, { ax: 0, ay: 1, az: 0, bx: jx, by: 0.55, bz: jz, cx: 0, cy: 0.1, cz: 0, tx: 0.05, ty: 0.4, tz: 0.02, px: pole[0], py: pole[1], pz: pole[2] });
    const s1 = Math.sqrt(0.45 * 0.45 + jx * jx + jz * jz);
    m.solveTwoBone(q, o);
    const td = sub([0.05, 0.4, 0.02], [0, 1, 0]);
    const w = sub([o.kx, o.ky, o.kz], [0, 1, 0]);
    const tl = len(td);
    const pr = dot(w, td) / tl;
    const kp: V = [w[0] - (td[0] / tl) * pr, w[1] - (td[1] / tl) * pr, w[2] - (td[2] / tl) * pr];
    const pp = dot(pole, td) / tl;
    const pw: V = [pole[0] - (td[0] / tl) * pp, pole[1] - (td[1] / tl) * pp, pole[2] - (td[2] / tl) * pp];
    if (len(pw) > 1e-3 && dot(kp, pw) <= 0) v.poleWrong++;
    v.lengthWorst = Math.max(v.lengthWorst, Math.abs(len(w) - s1), Math.abs(len(sub([o.ex, o.ey, o.ez], [o.kx, o.ky, o.kz])) - s1));
  }
  return v;
}

/**
 * A leg as a walk's stance has it, nearly straight (the knee a few centimetres ahead of the hip-to-ankle line, the front
 * +z), its ankle's target moved forward, back, up, down and aside, as the feet's placement moves it (a toe lifted, a
 * kerb, a slope, an edge pull): the review's case (a knee read off the line to the target bent backward there).
 */
interface LegVerdict { cases: number; backward: number; inPlaneWorst: number; offPlaneWorst: number; reachedWorst: number }
function legs(m: Mod): LegVerdict {
  const q = new m.TwoBoneAsk();
  const o = new m.TwoBoneOut();
  const v: LegVerdict = { cases: 0, backward: 0, inPlaneWorst: 0, offPlaneWorst: 0, reachedWorst: 0 };
  const a: V = [0, 1, 0];
  for (const fwd of [0.012, 0.027, 0.06, 0.12]) {
    // The posed knee `fwd` ahead of the line, the posed ankle under the hip; the bones' lengths kept.
    const b: V = [0, 0.55, fwd];
    const c: V = [0, 0.1, 0];
    const l1 = len(sub(b, a));
    const l2 = len(sub(c, b));
    const nPose = cross(sub(b, a), sub(c, a));
    const np = nPose.map((x) => x / len(nPose)) as V;
    for (const dz of [-0.15, -0.1, -0.05, 0, 0.05, 0.1, 0.15]) {
      for (const dy of [-0.05, 0, 0.02, 0.05, 0.1, 0.2]) {
        for (const dx of [0, -0.06, -0.03, 0.03, 0.06]) {
          const t: V = [c[0] + dx, c[1] + dy, c[2] + dz];
          Object.assign(q, { ax: a[0], ay: a[1], az: a[2], bx: b[0], by: b[1], bz: b[2], cx: c[0], cy: c[1], cz: c[2], tx: t[0], ty: t[1], tz: t[2], px: 0, py: 0, pz: 1 });
          m.solveTwoBone(q, o);
          v.cases++;
          const k: V = [o.kx, o.ky, o.kz];
          const e: V = [o.ex, o.ey, o.ez];
          // Forward of its own line, hip to ankle, as the pose has it (the front, +z, is the pose's bend).
          if (offLine(a, e, k)[2] <= 0) v.backward++;
          const off = Math.abs(dot(sub(k, a), np));
          if (dx === 0) v.inPlaneWorst = Math.max(v.inPlaneWorst, off);
          else v.offPlaneWorst = Math.max(v.offPlaneWorst, off / Math.abs(dot(sub(t, a), np)));
          const dl = len(sub(t, a));
          if (dl <= l1 + l2 - 1e-3 && dl >= Math.abs(l1 - l2) + 1e-3) v.reachedWorst = Math.max(v.reachedWorst, len(sub(e, t)));
        }
      }
    }
  }
  return v;
}

const now = await load(SRC);
const v = measure(now);
ok(v.reachedWorst < 1e-3, `wherever the limb can reach the target, the end meets it within a millimetre (worst ${(v.reachedWorst * 1000).toExponential(2)} mm over 4000 limbs)`);
ok(v.shortWrong === 0 && v.overStretched === 0, 'where it cannot, the end stops short on the line from the root to the target, and the limb is never longer than its two bones');
ok(v.lengthWorst < 1e-9, `the bones keep their lengths to the float (worst ${v.lengthWorst.toExponential(2)} m)`);
ok(v.planeWorst < 1e-9, `the knee stays in the plane through the root, the target and the pose's own bend (the posed knee's offset from the posed root-to-end line) (worst ${v.planeWorst.toExponential(2)} m off it)`);
ok(v.backward === 0, 'the knee bends the way the pose bends it: its offset from its own line, root to end, never leans against the posed knee\'s offset from the posed line (never backward)');
const lv = legs(now);
ok(lv.cases === 840 && lv.backward === 0 && lv.reachedWorst < 1e-3, `a nearly straight leg (the knee 1.2 to 12 cm ahead of the hip-to-ankle line), its ankle's target moved up to 15 cm forward and back, 20 cm up, 5 cm down and 6 cm aside: the knee stays ahead of its own line in all ${lv.cases} (the end on the target within ${(lv.reachedWorst * 1000).toExponential(1)} mm)`);
ok(lv.inPlaneWorst < 1e-9 && lv.offPlaneWorst <= 1, `and in the pose's own plane: exactly for a target moved within it (worst ${lv.inPlaneWorst.toExponential(1)} m), and off it by at most as much as the target is (worst ${lv.offPlaneWorst.toFixed(3)} of the target's own offset)`);
ok(v.identityWorst < 1e-9, `asked for the posed end, it hands back the posed knee and end (worst ${v.identityWorst.toExponential(2)} m)`);
ok(v.poleWrong === 0, 'a straight posed limb bends toward the caller\'s pole');

// Mutations: each rule broken in a copy of the file fails its check.
const mutate = async (from: string, to: string, fails: (x: Verdict) => boolean, what: string) => {
  assert.ok(SRC.includes(from), `a mutation found nothing to change: ${from}`);
  const m = await load(SRC.replace(from, to));
  ok(fails(measure(m)), `mutation: ${what}`);
};
await mutate('o.kx = q.ax + dx * x + wx * h;', 'o.kx = q.ax + dx * x - wx * h;', (x) => x.backward > 0 || x.reachedWorst > 1e-3, 'the knee on the far side of the line (its pole turned round): it bends backward');
await mutate('if (d > most) d = most;', 'if (d > most * 1.2) d = most * 1.2;', (x) => x.overStretched > 0 || x.lengthWorst > 1e-6, 'the reach not held to the bones\' length: the limb stretches');
await mutate('const h = hh > 0 ? Math.sqrt(hh) : 0;', 'const h = hh > 0 ? Math.sqrt(hh) * 0.9 : 0;', (x) => x.lengthWorst > 1e-6 || x.reachedWorst > 1e-3, 'the knee off the two circles\' meeting: the bones change length');
await mutate('const pd = q.px * dx + q.py * dy + q.pz * dz;', 'const pd = -(q.px * dx + q.py * dy + q.pz * dz) * 0;', (x) => x.poleWrong > 0 || x.lengthWorst > 1e-6, 'the caller\'s pole not taken off the reach: a straight limb\'s bones change length');
await mutate('const bent = Math.sqrt(sx * sx + sy * sy + sz * sz) / (l1 * l2) >= POSED_BENT;', 'const bent = true;', (x) => x.poleWrong > 0, 'a straight posed limb read for a side it has not got: it bends off the caller\'s pole');
{
  // The pole read off the line to the TARGET (the posed knee's offset from root-to-target), as the wave first had it.
  const from = 'const au = abx * ux + aby * uy + abz * uz;';
  assert.ok(SRC.includes(from), `a mutation found nothing to change: ${from}`);
  const m = await load(SRC.replace(from, 'const au = 0;'));
  const lm = legs(m);
  ok(lm.backward > 0 || lm.inPlaneWorst > 1e-6, `mutation: the pole read off the line to the target, not the posed limb's own: a nearly straight leg whose target moves forward bends its knee backward (${lm.backward} of ${lm.cases}) and out of its plane (${lm.inPlaneWorst.toFixed(3)} m)`);
}

console.log(`twoBone: ${checks} checks passed`);
