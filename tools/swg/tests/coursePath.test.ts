// The race drawer's spine (src/race/coursePath.ts, DESIGN.md §2.3): a curve passes through every node, a straight is
// straight, the tangent is continuous where a curve meets a straight and a short curve between two near-opposite straights
// does not loop (the forced tangent keeps the centripetal length), the road's numbers never overshoot their nodes and the
// grade has no kink at a node between unequal edges (random courses), arclength steps never past `SPINE_STEP`, each edge's
// samples depend only on the nodes that shape it (a node moved leaves every edge outside i - 3 to i + 2 to the bit, and the
// dirty set worked out is never wider), a closed path wraps and its nodes rotated give the same edges to the bit, and the
// driver's right in the raw frame is `gridSlot`'s right in the game's frame carried by `fromGame`.
//
// Run: node tools/swg/tests/coursePath.test.ts
import assert from 'node:assert/strict';
import { SPINE_STEP, buildSpine, dirtyEdges, edgeCrossesItself, nearestOn, rightOf, sameEdge, spineAt, spineNear, spinePoint, type SpineNode } from '../../../src/race/coursePath.ts';
import { gridSlot } from '../../../src/race/raceGroup.ts';
import { fromGame } from '../../../src/story/placements.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const node = (x: number, z: number, o: Partial<SpineNode> = {}): SpineNode => ({ x, y: 0, z, w: 20, b: 0, sh: 6, c: 'smooth', ...o });

// A seeded random (xorshift), so a failure is the same failure every run.
let seed = 0x2468ace1;
const rnd = () => {
  seed ^= seed << 13;
  seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  seed >>>= 0;
  return seed / 4294967296;
};

/** A random path of `n` nodes 20 to 300 m apart, wandering, its numbers random within their limits, its edges random kinds. */
function randomPath(n: number): SpineNode[] {
  const out: SpineNode[] = [];
  let x = 0;
  let z = 0;
  let h = 0;
  for (let i = 0; i < n; i++) {
    out.push({ x, y: (rnd() - 0.5) * 40, z, w: 4 + rnd() * 76, b: (rnd() - 0.5) * 90, sh: rnd() * 64, c: rnd() < 0.3 ? 'straight' : 'smooth' });
    h += (rnd() - 0.5) * 1.6;
    const d = 20 + rnd() * 280;
    x += Math.sin(h) * d;
    z += Math.cos(h) * d;
  }
  return out;
}

// ---- A curve passes through its nodes; a straight is straight. ----
{
  const nodes = [node(0, 0), node(100, 30), node(160, 140), node(90, 260, { c: 'straight' }), node(-40, 300)];
  const sp = buildSpine(nodes, false);
  let through = true;
  for (let e = 0; e < sp.edges.length; e++) {
    const ed = sp.edges[e];
    const a = nodes[ed.from];
    const b = nodes[ed.to];
    if (ed.x[0] !== a.x || ed.z[0] !== a.z || ed.x[ed.count - 1] !== b.x || ed.z[ed.count - 1] !== b.z) through = false;
  }
  ok(through, 'every edge starts on the node it leaves and ends on the node it reaches, exactly');
  const st = sp.edges[3];
  const a = nodes[3];
  const b = nodes[4];
  let off = 0;
  for (let i = 0; i < st.count; i++) {
    const cross = Math.abs((b.x - a.x) * (st.z[i] - a.z) - (b.z - a.z) * (st.x[i] - a.x)) / Math.hypot(b.x - a.x, b.z - a.z);
    off = Math.max(off, cross);
  }
  ok(off < 1e-9, `a straight edge's samples lie on its line (worst ${off.toExponential(2)} m off)`);
  ok(Math.abs(st.len - Math.hypot(b.x - a.x, b.z - a.z)) < 1e-6, "a straight edge's length is its chord");
}

// ---- Arclength steps. ----
{
  let worstS = 0;
  let worstChord = 0;
  for (let k = 0; k < 20; k++) {
    const sp = buildSpine(randomPath(12), k % 2 === 0);
    for (const ed of sp.edges)
      for (let i = 1; i < ed.count; i++) {
        worstS = Math.max(worstS, ed.s[i] - ed.s[i - 1]);
        worstChord = Math.max(worstChord, Math.hypot(ed.x[i] - ed.x[i - 1], ed.z[i] - ed.z[i - 1]));
      }
  }
  ok(worstS <= SPINE_STEP + 1e-9, `no arclength step past ${SPINE_STEP} m (worst ${worstS.toFixed(4)} m)`);
  ok(worstChord <= SPINE_STEP * 1.01, `no sample a step further than ${SPINE_STEP} m on the ground give or take a hundredth (worst ${worstChord.toFixed(4)} m)`);
}

// ---- Tangent continuous where a curve meets a straight; a short curve between near-opposite straights does not loop. ----
{
  // A straight east, a short curve, a straight back west: a hairpin of 30 m across between two 400 m straights.
  const nodes = [node(-400, 0, { c: 'straight' }), node(0, 0), node(4, 30, { c: 'straight' }), node(-400, 30)];
  const sp = buildSpine(nodes, false);
  const angleAt = (e: number, last: boolean) => {
    const ed = sp.edges[e];
    const i = last ? ed.count - 2 : 0;
    return Math.atan2(ed.x[i + 1] - ed.x[i], ed.z[i + 1] - ed.z[i]);
  };
  const turn = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const inA = turn(angleAt(0, true), angleAt(1, false));
  const outA = turn(angleAt(1, true), angleAt(2, false));
  // Two-metre chords cannot show a tangent exactly: a curve leaving a straight tangentially turns at the junction by about
  // half what it turns over its next step (the chord's own lean), where a corner turns there by far more.
  const ed = sp.edges[1];
  const chord = (i: number) => Math.atan2(ed.x[i + 1] - ed.x[i], ed.z[i + 1] - ed.z[i]);
  const nextIn = turn(chord(0), chord(1));
  const nextOut = turn(chord(ed.count - 3), chord(ed.count - 2));
  ok(inA <= nextIn + 1e-9 && outA <= nextOut + 1e-9, `the curve leaves and joins its straights tangentially: at each junction it turns less than over its next step (${((inA * 180) / Math.PI).toFixed(2)}° against ${((nextIn * 180) / Math.PI).toFixed(2)}°, ${((outA * 180) / Math.PI).toFixed(2)}° against ${((nextOut * 180) / Math.PI).toFixed(2)}°)`);
  ok(!edgeCrossesItself(sp.edges[1]), 'the short curve between two near-opposite straights does not cross itself');
}

// ---- Heights, widths, banks and shoulders never overshoot; the grade has no kink at a node. ----
{
  let worstOver = 0;
  let worstKink = 0;
  for (let k = 0; k < 40; k++) {
    const nodes = randomPath(10);
    const closed = k % 2 === 1;
    const sp = buildSpine(nodes, closed);
    for (const ed of sp.edges) {
      const a = nodes[ed.from];
      const b = nodes[ed.to];
      const bound = (va: number, vb: number, v: Float64Array | number[], f: (x: number) => number) => {
        const lo = Math.min(va, vb);
        const hi = Math.max(va, vb);
        for (let i = 0; i < ed.count; i++) {
          const x = f(v[i]);
          worstOver = Math.max(worstOver, lo - x, x - hi);
        }
      };
      bound(a.y, b.y, ed.y, (x) => x);
      bound(a.w / 2, b.w / 2, ed.hw, (x) => x);
      bound(a.b, b.b, ed.tb, (x) => (Math.atan(x) * 180) / Math.PI);
      bound(a.sh, b.sh, ed.sh, (x) => x);
    }
    // The grade either side of each interior node, by second-order one-sided differences over the last and first three
    // samples: one slope, no kink. Against it the secants either side, which a slope worked out per edge would follow.
    for (let e = 0; e + 1 < sp.edges.length; e++) {
      const A = sp.edges[e];
      const B = sp.edges[e + 1];
      if (A.count < 4 || B.count < 4) continue;
      const n = A.count - 1;
      const ha = A.s[n] - A.s[n - 1];
      const hb = B.s[1] - B.s[0];
      // The height is a cubic in arclength on each edge and its samples are evenly spaced, so the third difference is its
      // third derivative exactly and takes the one-sided differences' own error (h² y''' / 3) off them.
      const ta = (A.y[n] - 3 * A.y[n - 1] + 3 * A.y[n - 2] - A.y[n - 3]) / (ha * ha * ha);
      const tb = (B.y[3] - 3 * B.y[2] + 3 * B.y[1] - B.y[0]) / (hb * hb * hb);
      const gin = (3 * A.y[n] - 4 * A.y[n - 1] + A.y[n - 2]) / (2 * ha) + (ha * ha * ta) / 3;
      const gout = (-3 * B.y[0] + 4 * B.y[1] - B.y[2]) / (2 * hb) + (hb * hb * tb) / 3;
      const din = (A.y[n] - A.y[0]) / A.len;
      const dout = (B.y[B.count - 1] - B.y[0]) / B.len;
      // What is left is the samples' own rounding: held to a millionth of the secants' jump and a hair.
      worstKink = Math.max(worstKink, Math.abs(gin - gout) - 1e-6 * Math.abs(din - dout) - 1e-7);
    }
  }
  ok(worstOver <= 1e-9, `no road number past the higher of its two nodes or under the lower over forty random paths (worst ${worstOver.toExponential(2)})`);
  ok(worstKink <= 0, `the grade has no kink at a node between unequal edges (worst excess ${worstKink.toExponential(2)})`);
}

// ---- Edge independence and the dirty set. ----
{
  let outside = 0;
  let wider = 0;
  let tested = 0;
  for (let k = 0; k < 30; k++) {
    const closed = k % 2 === 0;
    const nodes = randomPath(14);
    const was = buildSpine(nodes, closed);
    const i = 2 + Math.floor(rnd() * 10);
    const moved = nodes.map((n, j) => (j === i ? { ...n, x: n.x + 15 * (rnd() - 0.5), z: n.z + 15 * (rnd() - 0.5), y: n.y + 3 } : n));
    const now = buildSpine(moved, closed);
    const n = nodes.length;
    const allowed = new Set<number>();
    for (let d = -3; d <= 2; d++) {
      const e = closed ? (((i + d) % n) + n) % n : i + d;
      if (e >= 0 && e < now.edges.length) allowed.add(e);
    }
    for (let e = 0; e < now.edges.length; e++) {
      if (allowed.has(e)) continue;
      tested++;
      if (!sameEdge(was.edges[e], now.edges[e])) outside++;
    }
    for (const e of dirtyEdges(was, now)) if (!allowed.has(e)) wider++;
  }
  ok(tested > 100 && outside === 0, `a node moved leaves every edge outside i - 3 to i + 2 the same to the bit (${tested} edges looked at)`);
  ok(wider === 0, 'the dirty set worked out by comparing is never wider than i - 3 to i + 2');
}

// ---- A closed path wraps; its nodes rotated give the same edges to the bit. ----
{
  const nodes = randomPath(9);
  const sp = buildSpine(nodes, true);
  ok(sp.edges.length === nodes.length && sp.edges[nodes.length - 1].to === 0, 'a closed path has an edge a node, its last back to node 0');
  let same = true;
  for (let r = 1; r < nodes.length; r++) {
    const rot = [...nodes.slice(r), ...nodes.slice(0, r)];
    const sr = buildSpine(rot, true);
    for (let e = 0; e < nodes.length; e++) {
      const a = sp.edges[(e + r) % nodes.length];
      const b = sr.edges[e];
      // Their own node numbers differ by the rotation; their samples must not.
      const bb = { ...b, from: a.from, to: a.to };
      if (!sameEdge(a, bb)) same = false;
    }
  }
  ok(same, "a closed path's nodes rotated give every edge's samples to the bit");
  // An edge's samples reused: a spine made again into itself answers the same samples.
  const again = buildSpine(nodes, true, sp);
  ok(again === sp && dirtyEdges(buildSpine(nodes, true), again).length === 0, 'a spine made again into its own arrays is the same spine to the bit');
}

// ---- The driver's right in the raw frame is gridSlot's right carried by fromGame. ----
{
  let worst = 0;
  for (let k = 0; k < 8; k++) {
    const hd = (k / 8) * Math.PI * 2 + 0.3;
    // A slot one across to the right of a grid at the origin facing hd, in the game's frame.
    const slot = gridSlot({ x: 0, y: 0, z: 0, heading: hd }, 1, 'podracer', { lead: 20, leadLeast: 5, across: 2, back: 0, perRow: 2, bikeShare: 1, keep: 600 });
    const base = gridSlot({ x: 0, y: 0, z: 0, heading: hd }, 0, 'podracer', { lead: 20, leadLeast: 5, across: 2, back: 0, perRow: 2, bikeShare: 1, keep: 600 });
    const gameRight = { x: slot.x - base.x, z: slot.z - base.z };
    const rawRight = fromGame({ x: gameRight.x, y: 0, z: gameRight.z, q: [0, 0, 0, 1] }, null, 'raw');
    // The nose in the game's frame carried into the raw frame is the raw tangent.
    const nose = fromGame({ x: Math.sin(hd), y: 0, z: Math.cos(hd), q: [0, 0, 0, 1] }, null, 'raw');
    const r = rightOf(nose.x, nose.z, { x: 0, z: 0 });
    const l = Math.hypot(rawRight.x, rawRight.z);
    worst = Math.max(worst, Math.hypot(r.x - rawRight.x / l, r.z - rawRight.z / l));
  }
  ok(worst < 1e-12, `rightOf along a raw tangent is gridSlot's right carried by fromGame, at eight headings (worst ${worst.toExponential(2)})`);
}

// ---- A point on the spine and the nearest point to one. ----
{
  const nodes = [node(0, 0), node(200, 0, { c: 'straight' }), node(400, 0)];
  const sp = buildSpine(nodes, false);
  const P = spinePoint();
  ok(spineAt(sp, 0, 0.5, P) && Math.abs(P.x - 100) < 1 && Math.abs(P.z) < 1, 'spineAt finds the middle of a straight edge');
  const near = spineNear();
  ok(nearestOn(sp, 250, 7, near) && near.e === 1 && Math.abs(near.t - 0.25) < 0.01 && Math.abs(near.d - 7) < 0.01, `nearestOn finds the edge, its share and the distance (${near.e}, ${near.t.toFixed(3)}, ${near.d.toFixed(2)})`);
  // The right of a road running +x in the raw frame is -z (the game's mirror).
  ok(near.o < 0, 'a point at +z of a road running +x in the raw frame is on its left (the right is -z)');
}

// ---- The knots are centripetal: a smooth edge is the centripetal Catmull-Rom curve, worked out here by Barry and Goldman's
// own pyramid (nothing of the spine's arithmetic), over nodes spaced very unevenly (where a uniform knot loops and overshoots).
{
  const P = [node(0, 0), node(220, 0), node(226, 4), node(240, 180), node(60, 260)];
  const sp = buildSpine(P, true);
  const tk = (a: SpineNode, b: SpineNode) => Math.sqrt(Math.hypot(b.x - a.x, b.z - a.z));
  const lerp = (a: number[], b: number[], ta: number, tb: number, t: number) => [((tb - t) * a[0] + (t - ta) * b[0]) / (tb - ta), ((tb - t) * a[1] + (t - ta) * b[1]) / (tb - ta)];
  const near = spineNear();
  let worst = 0;
  // Edges 0, 1 and 2 (a long one, the short one and a long one), each through its four neighbouring nodes.
  for (const e of [0, 1, 2]) {
    const p = [P[(e + P.length - 1) % P.length], P[e], P[e + 1], P[(e + 2) % P.length]].map((q) => [q.x, q.z]);
    const t0 = 0;
    const t1 = t0 + tk(P[(e + P.length - 1) % P.length], P[e]);
    const t2 = t1 + tk(P[e], P[e + 1]);
    const t3 = t2 + tk(P[e + 1], P[(e + 2) % P.length]);
    for (let k = 1; k < 20; k++) {
      const t = t1 + ((t2 - t1) * k) / 20;
      const a1 = lerp(p[0], p[1], t0, t1, t);
      const a2 = lerp(p[1], p[2], t1, t2, t);
      const a3 = lerp(p[2], p[3], t2, t3, t);
      const b1 = lerp(a1, a2, t0, t2, t);
      const b2 = lerp(a2, a3, t1, t3, t);
      const c = lerp(b1, b2, t1, t2, t);
      nearestOn(sp, c[0], c[1], near);
      worst = Math.max(worst, near.d);
    }
  }
  // The polyline of 2 m samples sags off the curve by s^2 / 8R, a tenth of a metre on the short edge's tight bend: a uniform knot puts the curve metres off.
  ok(worst < 0.25, `every smooth edge lies on the centripetal Catmull-Rom curve through its nodes, unevenly spaced, within its samples' sag (worst ${worst.toFixed(4)} m off)`);
}

console.log(`\ncoursePath: ${checks} checks passed`);
