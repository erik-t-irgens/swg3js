// Climbing II, phase 1: the test course's layout (src/anim/climbCourse.ts) and what stands it (src/anim/climbCourseBuild.ts):
//  - the layout is deterministic, every id is unique, `pieces` stands only the ids asked, an unknown id is named;
//  - every piece stands on a level floor slab of its own (its top at nought, under every solid and start, `floor` deep);
//  - every piece's solids measure back to the numbers it was made to test (a lip's height over its floor and its kind, a
//    corner's turn, a curve's radius and steps, a slope's angle, a step's height, a gap's span each way, a corridor's width,
//    a wall's height and top, the bars' spacing, height, radius and pit, the rope's and the poles' places, an obstacle's
//    size and run-up, the free run's links), worked out from the solids' own corners and never from the numbers;
//  - every lip a piece declares lies on a top edge of one of its solids with that solid behind it;
//  - no two solids of a piece overlap, and no two pieces' slabs do;
//  - the colliders and the triangle list stand exactly the solids carried into the world (a turned, raised frame);
//  - the game's `__debug.climbTest` builds from the one layout through the one builder (its calls pinned as text).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BEHIND_SPANS, GAP_SPANS, LIP_HEIGHTS, ROOM_HEIGHT, ROOM_ROOF_TOP, ROOM_ROW, TODAY_REACH, climbCourse, courseIds, solidFoot, type CoursePiece, type CourseSolid } from '../../../src/anim/climbCourse.ts';
import { buildCourseColliders, courseToWorld, courseTriangles, solidCorners, worldToCourse, type CourseFrame } from '../../../src/anim/climbCourseBuild.ts';
import { CLIMB_TUNE } from '../../../src/anim/climbTune.ts';
import { Physics, RAPIER } from '../../../src/core/physics.ts';
import { REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const DEG = Math.PI / 180;

const course = climbCourse();
const byId = new Map(course.pieces.map((p) => [p.id, p]));
const P = (id: string): CoursePiece => {
  const p = byId.get(id);
  assert.ok(p, `the course has ${id}`);
  return p!;
};

// ---- solids read back from their corners ----------------------------------------------------------------------------------
const nonFloor = (p: CoursePiece) => p.solids.filter((s) => s.role !== 'floor');
const topOf = (s: CourseSolid) => solidFoot(s).y1;
const y0Of = (s: CourseSolid) => solidFoot(s).y0;
const xs = (s: CourseSolid) => solidFoot(s).foot.map((q) => q[0]);
const zs = (s: CourseSolid) => solidFoot(s).foot.map((q) => q[1]);
const minX = (s: CourseSolid) => Math.min(...xs(s));
const maxX = (s: CourseSolid) => Math.max(...xs(s));
const minZ = (s: CourseSolid) => Math.min(...zs(s));
const maxZ = (s: CourseSolid) => Math.max(...zs(s));
const byRole = (p: CoursePiece, r: string) => p.solids.filter((s) => s.role === r);
/** A prism's front edge (its first two footprint corners) and that edge's top heights. */
const front = (s: CourseSolid) => {
  if (s.kind !== 'prism') throw new Error('not a prism');
  return { a: s.foot[0], b: s.foot[1], ta: s.tops[0], tb: s.tops[1] };
};
const turnBetween = (a: [number, number], b: [number, number]) => Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]) / DEG;
const dirOf = (e: { a: [number, number]; b: [number, number] }): [number, number] => {
  const dx = e.b[0] - e.a[0];
  const dz = e.b[1] - e.a[1];
  const l = Math.hypot(dx, dz);
  return [dx / l, dz / l];
};

// ---- 1. the layout itself -------------------------------------------------------------------------------------------------
{
  const again = climbCourse();
  ok(JSON.stringify(again) === JSON.stringify(course), 'the layout is deterministic: two answers are the same to the last digit');
  const ids = course.pieces.map((p) => p.id);
  ok(new Set(ids).size === ids.length, `every id is unique (${ids.length} pieces)`);
  ok(JSON.stringify(courseIds()) === JSON.stringify(ids), 'courseIds names every piece in the course\'s order');
  const kinds = new Set(course.pieces.map((p) => p.kind));
  ok(['lip', 'wall', 'corner', 'slope', 'steps', 'gap', 'bar', 'rope', 'pole', 'obstacle', 'run'].every((k) => kinds.has(k as never)), `every kind the design names has a piece (${[...kinds].join(', ')})`);
  const some = climbCourse({ pieces: ['wall-6', 'gap-side-2.0', 'nothing-here'] });
  ok(some.pieces.map((p) => p.id).join() === 'gap-side-2.0,wall-6' && some.unknown.join() === 'nothing-here', '`pieces` stands only the ids asked (in the course\'s order) and names an id it has not got');
  ok(JSON.stringify(climbCourse({ pieces: ['wall-6'] }).pieces[0].solids) === JSON.stringify(P('wall-6').solids), 'a piece stood alone is the same piece (its own frame), only placed elsewhere');
  ok(course.reach.standing === TODAY_REACH.standing && course.reach.running === TODAY_REACH.running && course.lipSlope === CLIMB_TUNE.lipSlope, `the reaches are today's measured ones (${TODAY_REACH.standing}, ${TODAY_REACH.running}) and the lip slope the tune's (${CLIMB_TUNE.lipSlope})`);
  const deep = climbCourse({ floor: 3.5 });
  ok(deep.pieces.every((p) => near(y0Of(byRole(p, 'floor')[0]), -3.5)) && JSON.stringify(deep.pieces.map((p) => p.at)) === JSON.stringify(course.pieces.map((p) => p.at)), 'a deeper floor deepens every slab and moves no piece');
}

// ---- 2. the slabs, the overlaps, the declared lips -------------------------------------------------------------------------
/** Two convex footprints overlapping with an area (separating axes; touching is not overlapping). */
function feetOverlap(a: [number, number][], b: [number, number][]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const nx = -(q[1] - p[1]);
      const nz = q[0] - p[0];
      const proj = (pts: [number, number][]) => pts.map((r) => r[0] * nx + r[1] * nz);
      const pa = proj(a);
      const pb = proj(b);
      if (Math.max(...pa) <= Math.min(...pb) + 1e-6 || Math.max(...pb) <= Math.min(...pa) + 1e-6) return false;
    }
  }
  return true;
}
function solidsOverlap(a: CourseSolid, b: CourseSolid): boolean {
  const fa = solidFoot(a);
  const fb = solidFoot(b);
  if (fa.y1 <= fb.y0 + 1e-6 || fb.y1 <= fa.y0 + 1e-6) return false;
  return feetOverlap(fa.foot, fb.foot);
}
/** A point inside a convex footprint (strictly, by `eps`). */
function inFoot(foot: [number, number][], x: number, z: number, eps = 1e-6): boolean {
  let sign = 0;
  for (let i = 0; i < foot.length; i++) {
    const p = foot[i];
    const q = foot[(i + 1) % foot.length];
    const c = (q[0] - p[0]) * (z - p[1]) - (q[1] - p[1]) * (x - p[0]);
    if (Math.abs(c) <= eps) continue;
    const sg = Math.sign(c);
    if (sign && sg !== sign) return false;
    sign = sg;
  }
  return true;
}
/** A point's height on a solid's top (planar: through three of its top corners), or NaN off its footprint. */
function topAt(s: CourseSolid, x: number, z: number): number {
  const { foot } = solidFoot(s);
  if (!inFoot(foot, x, z, 1e-4)) return Number.NaN;
  if (s.kind === 'box') return s.mid[1] + s.half[1];
  const [a, b, c] = [0, 1, 2].map((i) => [foot[i][0], s.tops[i], foot[i][1]]);
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  return a[1] - (n[0] * (x - a[0]) + n[2] * (z - a[2])) / n[1];
}
{
  let slabs = 0;
  let lips = 0;
  for (const p of course.pieces) {
    const floor = byRole(p, 'floor');
    assert.ok(floor.length === 1, `${p.id}: one floor slab`);
    const s = floor[0];
    const f = solidFoot(s);
    assert.ok(near(f.y1, 0) && near(f.y0, -course.floor) && near(minX(s), p.bounds.x0) && near(maxX(s), p.bounds.x1) && near(minZ(s), p.bounds.z0) && near(maxZ(s), p.bounds.z1), `${p.id}: its slab's top is nought and it covers its bounds`);
    for (const o of nonFloor(p)) for (const [x, z] of solidFoot(o).foot) assert.ok(x >= p.bounds.x0 && x <= p.bounds.x1 && z >= p.bounds.z0 && z <= p.bounds.z1, `${p.id}: every solid stands on the slab`);
    for (const st of p.starts) assert.ok(st.at[0] > p.bounds.x0 && st.at[0] < p.bounds.x1 && st.at[2] > p.bounds.z0 && st.at[2] < p.bounds.z1 && near(Math.hypot(st.face[0], st.face[1]), 1), `${p.id}: its start ${st.name} is on the slab, facing a unit way`);
    slabs++;
    // No two of its solids overlap.
    for (let i = 0; i < p.solids.length; i++) for (let j = i + 1; j < p.solids.length; j++) assert.ok(!solidsOverlap(p.solids[i], p.solids[j]), `${p.id}: solids ${i} and ${j} do not overlap`);
    // Every declared lip: each end and its middle on a solid's top edge, the solid behind it (in along -out) and open in front.
    for (const L of p.lips) {
      for (const u of [0.02, 0.5, 0.98]) {
        const x = L.a[0] + (L.b[0] - L.a[0]) * u;
        const y = L.a[1] + (L.b[1] - L.a[1]) * u;
        const z = L.a[2] + (L.b[2] - L.a[2]) * u;
        const inX = x - L.out[0] * 0.01;
        const inZ = z - L.out[1] * 0.01;
        const tops = nonFloor(p).map((o) => topAt(o, inX, inZ)).filter((t) => Number.isFinite(t));
        assert.ok(tops.length >= 1 && tops.some((t) => near(t, y, 1e-3)), `${p.id}: lip ${L.name} at ${u}: a solid's top behind it at its height (${tops.map((t) => t.toFixed(3)).join()} against ${y.toFixed(3)})`);
        const outX = x + L.out[0] * 0.01;
        const outZ = z + L.out[1] * 0.01;
        const over = nonFloor(p).filter((o) => {
          const t = topAt(o, outX, outZ);
          return Number.isFinite(t) && y0Of(o) < y - 0.05 && t > y - 0.05;
        });
        assert.ok(over.length === 0, `${p.id}: lip ${L.name} at ${u}: nothing stands just out from it at its height (its face is open)`);
      }
      lips++;
    }
  }
  ok(slabs === course.pieces.length, `every piece stands on one level slab of its own, under every solid and start, no two of its solids overlapping (${slabs})`);
  ok(lips > 100, `every declared lip lies on a top edge with its solid behind it and its face open (${lips} lips)`);
  // No two pieces' slabs overlap in the course's frame.
  const slab = (p: CoursePiece): [number, number][] => [[p.at[0] + p.bounds.x0, p.at[1] + p.bounds.z0], [p.at[0] + p.bounds.x1, p.at[1] + p.bounds.z0], [p.at[0] + p.bounds.x1, p.at[1] + p.bounds.z1], [p.at[0] + p.bounds.x0, p.at[1] + p.bounds.z1]];
  let apart = true;
  for (let i = 0; i < course.pieces.length; i++) for (let j = i + 1; j < course.pieces.length; j++) if (feetOverlap(slab(course.pieces[i]), slab(course.pieces[j]))) apart = false;
  ok(apart, 'no two pieces\' slabs overlap in the course\'s frame');
}

// ---- 3. every piece measured back to its numbers -----------------------------------------------------------------------------
{
  // Lips: the height of the highest solid over the slab's top, braced (the solid at the lip stands from the floor) or free
  // (the solid at the lip is a plate, nothing under it for its overhang).
  const lipIds = course.pieces.filter((p) => p.kind === 'lip');
  const heights = [...LIP_HEIGHTS, TODAY_REACH.standing, TODAY_REACH.standing + 0.25, TODAY_REACH.running, TODAY_REACH.running + 0.25];
  for (const braced of [true, false]) {
    const got = lipIds.filter((p) => p.numbers.braced === braced).map((p) => Math.max(...nonFloor(p).map(topOf)));
    ok(got.length === heights.length && heights.every((h) => got.some((g) => near(g, h, 1e-6))), `${braced ? 'braced' : 'free'} lips stand at ${got.map((g) => g.toFixed(2)).join(', ')} m over their floor: 1.2 to 3.6 and the two reaches and 0.25 m past each`);
  }
  for (const p of lipIds) {
    const H = p.numbers.height as number;
    const atLip = nonFloor(p).filter((s) => near(minZ(s), 5) && near(topOf(s), H));
    assert.ok(atLip.length === 1 && near(maxX(atLip[0]) - minX(atLip[0]), p.numbers.lipLength as number), `${p.id}: one solid at the lip, its lip ${p.numbers.lipLength} m long`);
    if (p.numbers.braced) assert.ok(near(y0Of(atLip[0]), 0), `${p.id}: braced, its wall stands from the floor under the lip`);
    else {
      const back = nonFloor(p).filter((s) => s !== atLip[0]);
      assert.ok(near(topOf(atLip[0]) - y0Of(atLip[0]), p.numbers.plate as number) && back.length === 1 && near(minZ(back[0]) - minZ(atLip[0]), p.numbers.overhang as number), `${p.id}: free, a plate ${p.numbers.plate} m thick standing ${p.numbers.overhang} m out from its back wall, nothing under its lip`);
    }
  }
  ok(true, `every lip's solid measures back to its height, its length, and braced or free (${lipIds.length})`);

  // Corners and bends: the turn between the first and last segments' front edges; curves: each step's turn and radius.
  for (const id of ['corner-outer-90', 'corner-inner-90', 'bend-outer-30', 'bend-outer-45', 'bend-outer-60', 'bend-inner-30', 'bend-inner-45', 'bend-inner-60']) {
    const p = P(id);
    const w = nonFloor(p).map(front);
    const turn = turnBetween(dirOf(w[0]), dirOf(w[w.length - 1]));
    const want = (p.numbers.angle as number) * (p.numbers.turn === 'outer' ? 1 : -1);
    assert.ok(near(turn, want, 1e-6) && w.every((e) => near(e.ta, p.numbers.height as number) && near(e.tb, p.numbers.height as number)), `${id}: turns ${turn.toFixed(3)} degrees`);
    ok(true, `${id}: its lip turns ${turn.toFixed(1)} degrees (${p.numbers.turn}), level at ${p.numbers.height} m`);
  }
  for (const id of ['curve-outer-3m', 'curve-inner-3m']) {
    const p = P(id);
    const w = nonFloor(p).map(front);
    const [cx, cz] = String(p.numbers.centre).split(',').map(Number);
    const turns: number[] = [];
    for (let i = 1; i < w.length; i++) turns.push(turnBetween(dirOf(w[i - 1]), dirOf(w[i])));
    const arc = w.slice(1, -1);
    const radii = arc.flatMap((e) => [Math.hypot(e.a[0] - cx, e.a[1] - cz), Math.hypot(e.b[0] - cx, e.b[1] - cz)]);
    const total = turns.reduce((a, b) => a + b, 0);
    const sgn = p.numbers.turn === 'outer' ? 1 : -1;
    ok(turns.every((t) => Math.abs(t) <= (p.numbers.step as number) + 1e-6) && near(total, sgn * (p.numbers.sweep as number), 1e-6) && radii.every((r) => near(r, p.numbers.radius as number, 1e-6)), `${id}: ${arc.length} steps of at most ${p.numbers.step} degrees (${turns.map((t) => t.toFixed(1)).join(' ')}) turning ${total.toFixed(1)} in all, every corner ${p.numbers.radius} m from its centre`);
  }

  // Slopes: the sloping prism's rise over its run along the lip.
  for (const p of course.pieces.filter((q) => q.kind === 'slope')) {
    const slope = nonFloor(p).map(front).find((e) => !near(e.ta, e.tb))!;
    const ang = Math.atan2(slope.tb - slope.ta, Math.hypot(slope.b[0] - slope.a[0], slope.b[1] - slope.a[1])) / DEG;
    ok(near(ang, p.numbers.angle as number, 1e-6), `${p.id}: its lip rises at ${ang.toFixed(3)} degrees along its length${p.numbers.pastLimit ? ` (just past the shimmy's limit, ${CLIMB_TUNE.lipSlope})` : ''}`);
  }
  ok(course.pieces.some((p) => p.id === `slope-${Math.round(CLIMB_TUNE.lipSlope) + 3}`), `one sloped lip stands just past today's lip slope limit read from the tune (${CLIMB_TUNE.lipSlope} + 3)`);

  // Steps: each segment 1.5 m, each top one step over the one on its left.
  for (const p of course.pieces.filter((q) => q.kind === 'steps')) {
    const seg = nonFloor(p).sort((a, b) => minX(a) - minX(b));
    const rises = seg.slice(1).map((s, i) => topOf(s) - topOf(seg[i]));
    ok(seg.length === 5 && seg.every((s) => near(maxX(s) - minX(s), 1.5)) && rises.every((r) => near(r, p.numbers.step as number, 1e-6)), `${p.id}: five lips of 1.5 m, each ${rises[0].toFixed(3)} m over the last (up to the right, down to the left)`);
  }

  // Gaps: sideways the span end to end; up and down the rise and the step back; diagonally both, and the span between them.
  const ends = (p: CoursePiece) => {
    const [a, b] = nonFloor(p).sort((s, t) => minX(s) - minX(t));
    return { a, b, dx: minX(b) - maxX(a), dy: topOf(b) - topOf(a) };
  };
  for (const d of GAP_SPANS) {
    const side = ends(P(`gap-side-${d.toFixed(1)}`));
    assert.ok(near(side.dx, d) && near(side.dy, 0), `gap-side-${d}: ${side.dx} across`);
    const ud = P(`gap-updown-${d.toFixed(1)}`);
    const [lo, hi] = nonFloor(ud).sort((s, t) => topOf(s) - topOf(t));
    assert.ok(near(topOf(hi) - topOf(lo), d) && near(minZ(hi) - minZ(lo), ud.numbers.setback as number) && near(maxZ(lo), minZ(hi)), `gap-updown-${d}: ${topOf(hi) - topOf(lo)} up`);
    assert.ok(near(minX(hi) - minX(lo), ud.numbers.open as number) && near(maxX(hi), maxX(lo)), `gap-updown-${d}: the lower lip open above over its first ${ud.numbers.open} m`);
    const dg = ends(P(`gap-diag-${d.toFixed(1)}`));
    assert.ok(near(Math.hypot(dg.dx, dg.dy), d, 1e-6) && near(dg.dx, dg.dy), `gap-diag-${d}: ${Math.hypot(dg.dx, dg.dy)} along 45 degrees`);
  }
  ok(true, `the hop gaps measure back: sideways ${GAP_SPANS[0]} to ${GAP_SPANS[GAP_SPANS.length - 1]} m end to end at one height, up and down the same rises in a wall stepped 0.3 m back, diagonally the same spans along 45 degrees`);
  for (const d of BEHIND_SPANS) {
    const p = P(`gap-behind-${d.toFixed(1)}`);
    const [b, a] = nonFloor(p).sort((s, t) => minZ(s) - minZ(t));
    assert.ok(near(minZ(a) - maxZ(b), d) && near(topOf(a), topOf(b)), `gap-behind-${d}: ${minZ(a) - maxZ(b)} wide`);
  }
  ok(true, `the corridors behind the body measure ${BEHIND_SPANS.join(', ')} m face to face, both lips at one height`);

  // Walls: the height over the floor and the top's depth (an edge has no room for the crouched capsule, 0.7 m).
  for (const p of course.pieces.filter((q) => q.kind === 'wall')) {
    const [w] = nonFloor(p);
    const deep = maxZ(w) - minZ(w);
    ok(near(topOf(w), p.numbers.height as number) && near(deep, p.numbers.depth as number) && (p.numbers.top === 'edge') === deep < 0.7, `${p.id}: ${topOf(w)} m tall, its top ${deep} m deep (${p.numbers.top === 'edge' ? 'nothing to stand on' : 'room to climb out onto'})`);
  }

  // Bars: their spacing, their height over the take-off, their radius, the pit's depth.
  for (const p of course.pieces.filter((q) => q.kind === 'bar')) {
    const bars = byRole(p, 'bar').sort((a, b) => minZ(a) - minZ(b));
    const plats = byRole(p, 'platform').sort((a, b) => minZ(a) - minZ(b));
    const mid = (s: CourseSolid) => (minZ(s) + maxZ(s)) / 2;
    const spacing = bars.slice(1).map((s, i) => mid(s) - mid(bars[i]));
    const yMid = (s: CourseSolid) => (topOf(s) + y0Of(s)) / 2;
    ok(bars.length === p.numbers.bars && spacing.every((s) => near(s, p.numbers.spacing as number)) && bars.every((s) => near(yMid(s) - topOf(plats[0]), p.numbers.over as number) && near((topOf(s) - y0Of(s)) / 2, p.numbers.radius as number) && near((maxZ(s) - minZ(s)) / 2, p.numbers.radius as number)) && near(topOf(plats[0]), p.numbers.pit as number) && near(mid(bars[0]) - maxZ(plats[0]), p.numbers.first as number), `${p.id}: ${bars.length} bars ${spacing.join(', ')} m apart, ${(yMid(bars[0]) - topOf(plats[0])).toFixed(2)} m over the take-off, ${p.numbers.radius} m round, over a pit ${topOf(plats[0])} m deep`);
  }
  {
    const p = P('rope');
    const [rope] = byRole(p, 'rope');
    const [beam] = byRole(p, 'beam');
    const plats = byRole(p, 'platform').sort((a, b) => minZ(a) - minZ(b));
    const rz = (minZ(rope) + maxZ(rope)) / 2;
    ok(near(y0Of(rope), p.numbers.overPit as number) && near(topOf(rope), y0Of(beam)) && near(rz - maxZ(plats[0]), p.numbers.fromEdge as number) && near(minZ(plats[1]) - maxZ(plats[0]), p.numbers.across as number) && near(y0Of(beam), p.numbers.anchor as number), `rope: from its beam ${y0Of(beam)} m up to ${y0Of(rope)} m over the pit's floor, ${(rz - maxZ(plats[0])).toFixed(2)} m out from the edge of a pit ${minZ(plats[1]) - maxZ(plats[0])} m across`);
  }
  {
    const p = P('poles');
    const poles = byRole(p, 'pole');
    ok(poles.length === 2 && poles.every((s) => near(maxX(s) - minX(s), 0.08) && near(maxZ(s) - minZ(s), 0.08) && near(topOf(s), 6) && near(y0Of(s), 0)) && near(Math.abs(minX(poles[1]) - minX(poles[0])), 2), 'poles: two 0.08 m across and 6 m tall, 2 m apart');
  }
  for (const p of course.pieces.filter((q) => q.kind === 'obstacle')) {
    const [o] = nonFloor(p);
    const runUp = minZ(o) - p.starts[0].at[2];
    assert.ok(near(topOf(o), p.numbers.height as number) && near(maxZ(o) - minZ(o), p.numbers.depth as number) && near(runUp, p.numbers.runUp as number), `${p.id}: ${topOf(o)} high, ${maxZ(o) - minZ(o)} deep, ${runUp} m of run-up`);
  }
  ok(true, `the obstacles measure back: ${course.pieces.filter((q) => q.kind === 'obstacle').length} of them, each its height, its depth and 15 m of run-up`);
  {
    const p = P('run');
    const [a, b, c, d] = nonFloor(p);
    ok(near(minX(b) - maxX(a), p.numbers.hop as number) && near(topOf(c) - topOf(b), p.numbers.wall as number) && near(topOf(c) - topOf(d), p.numbers.drop as number) && near(maxZ(b), minZ(c)) && near(maxZ(c), minZ(d)) && near(maxX(b), 3), `run: a hop of ${minX(b) - maxX(a)} m, a lip round B's outer corner, a wall ${topOf(c) - topOf(b)} m over B's top and a drop of ${(topOf(c) - topOf(d)).toFixed(1)} m off its far side`);
  }
  // The feedback round's climbs up that only nearly fit: each lip at the round's height, braced (its wall from the floor) or
  // free (a plate and a back wall), and what stands over or on its top where its numbers say, in the course's last row.
  const room = course.pieces.filter((q) => q.kind === 'room');
  ok(room.map((p) => p.id).join() === 'room-beam,room-roof,room-sill,room-bump,room-none' && room.every((p) => p.row === ROOM_ROW) && course.pieces.slice(-room.length).every((p) => p.kind === 'room'), `the round's pieces stand in a row of their own, the course's last (${room.length})`);
  for (const p of room) {
    const H = p.numbers.height as number;
    const atLip = nonFloor(p).filter((s) => near(minZ(s), 5) && near(topOf(s), H) && s.role !== 'roof');
    assert.ok(near(H, ROOM_HEIGHT) && atLip.length === 1 && near(maxX(atLip[0]) - minX(atLip[0]), 6), `${p.id}: one solid at its lip, ${ROOM_HEIGHT} m over its floor, 6 m long`);
    if (p.numbers.braced) assert.ok(near(y0Of(atLip[0]), 0) && near(maxZ(atLip[0]) - minZ(atLip[0]), 2), `${p.id}: braced, its wall from the floor and its top 2 m deep`);
    else assert.ok(atLip[0].role === 'plate' && near(topOf(atLip[0]) - y0Of(atLip[0]), 0.3) && byRole(p, 'wall').length === 1 && near(minZ(byRole(p, 'wall')[0]) - 5, 2), `${p.id}: free, a plate 0.3 m thick 2 m out from its back wall`);
    const what = p.numbers.what as string;
    if (what === 'bump') {
      const ribs = byRole(p, 'bump');
      const at = String(p.numbers.ribs).split(',').map(Number);
      assert.ok(ribs.length === 3 && ribs.every((r, k) => near(y0Of(r), H) && near(topOf(r) - H, p.numbers.bump as number) && near(minZ(r) - 5, at[k]) && near(maxZ(r) - minZ(r), p.numbers.rib as number)), `${p.id}: three ribs ${p.numbers.bump} m tall on its top at ${at.join(', ')} m in`);
    } else {
      const over = what === 'beam' ? byRole(p, 'beam') : byRole(p, 'roof');
      assert.ok(over.length === 1 && near(y0Of(over[0]) - H, p.numbers.over as number) && near(minZ(over[0]) - 5, p.numbers.from as number) && (what === 'beam' ? near(maxZ(over[0]) - minZ(over[0]), p.numbers.deep as number) : near(topOf(over[0]) - H, ROOM_ROOF_TOP)), `${p.id}: its ${what === 'beam' ? 'beam' : 'roof'}'s underside ${p.numbers.over} m over the top, from ${p.numbers.from} m in`);
    }
  }
  ok(true, `the round's pieces measure back: their lips, braced or free, and the beam, roofs, lintel and ribs over and on their tops (${room.length})`);
}

// ---- 4. the colliders and the triangles stand exactly the solids, in a turned and raised frame ------------------------------
{
  const physics = await Physics.create();
  const refs = new Map(course.pieces.map((p, i) => [p.id, 3 + (i % 5) * 0.37]));
  const frame: CourseFrame = { ox: 12.5, oz: -40.25, h: 0.7, ref: (p) => refs.get(p.id)! };
  const made = buildCourseColliders(physics.world, course, frame);
  const solids = course.pieces.reduce((n, p) => n + p.solids.length, 0);
  ok(made.length === solids, `one collider a solid (${made.length})`);
  let k = 0;
  let worst = 0;
  const w = { x: 0, y: 0, z: 0 };
  for (const p of course.pieces) {
    for (const s of p.solids) {
      const c = made[k++].collider;
      const corners = solidCorners(frame, p, s);
      const all = [...corners.bottom, ...corners.top];
      // Every corner of the solid on the collider's surface (the engine's own projection: nought distance), and the
      // collider's own middle the corners' mean.
      for (const q of all) {
        const proj = c.shape.projectPoint(c.translation(), c.rotation(), { x: q[0], y: q[1], z: q[2] }, false);
        worst = Math.max(worst, Math.hypot(proj.point.x - q[0], proj.point.y - q[1], proj.point.z - q[2]));
      }
      if (s.kind === 'box') {
        courseToWorld(frame, p, s.mid[0], s.mid[1], s.mid[2], w);
        const t = c.translation();
        worst = Math.max(worst, Math.hypot(t.x - w.x, t.y - w.y, t.z - w.z));
      }
      assert.ok(c.parent() === null && c.collisionGroups() === ((0x0002 << 16) | 0xffff) >>> 0, `${p.id}: its colliders are bodiless and in the exterior group against every group`);
    }
  }
  ok(worst < 2e-4, `every solid's corners lie on its collider's surface and every box's middle is its collider's, carried into a frame turned 0.7 rad, moved and raised per piece (worst ${worst.toExponential(2)} m, the engine's single precision)`);
  // The point back into the piece's frame.
  const p0 = P('gap-diag-3.5');
  courseToWorld(frame, p0, 1.25, 2.5, 3.75, w);
  const back = worldToCourse(frame, p0, w.x, w.y, w.z, { x: 0, y: 0, z: 0 });
  ok(near(back.x, 1.25, 1e-9) && near(back.y, 2.5, 1e-9) && near(back.z, 3.75, 1e-9), 'a point carried into the world comes back to the piece\'s frame');
  // The triangles: two a footprint corner past two on each cap, two on each side, every one turned out of its solid.
  const tri = courseTriangles(course, frame);
  let want = 0;
  for (const p of course.pieces) for (const s of p.solids) want += 2 * (solidFoot(s).foot.length - 2) + 2 * solidFoot(s).foot.length;
  ok(tri.positions.length === want * 9 && tri.normals.length === want * 9 && tri.colors.length === want * 9, `one triangle list of the whole course (${want} triangles, positions, flat normals and colours)`);
  // Each triangle's corners are corners of solids (nothing drawn the colliders do not stand).
  const keys = new Set<string>();
  for (const p of course.pieces) for (const s of p.solids) {
    const c = solidCorners(frame, p, s);
    for (const q of [...c.bottom, ...c.top]) keys.add(q.map((v) => Math.fround(v).toFixed(4)).join(','));
  }
  let stray = 0;
  for (let i = 0; i < tri.positions.length; i += 3) if (!keys.has([tri.positions[i], tri.positions[i + 1], tri.positions[i + 2]].map((v) => v.toFixed(4)).join(','))) stray++;
  ok(stray === 0, 'every corner the triangles draw is a corner of a solid the colliders stand');
}

// ---- 5. the game's command builds from the one layout through the one builder -------------------------------------------------
{
  const main = readFileSync(join(REPO, 'src', 'main.ts'), 'utf8').replace(/\r\n/g, '\n');
  const at = main.indexOf('climbTest: async (');
  ok(at > 0, 'the game has `__debug.climbTest`');
  const body = main.slice(at, main.indexOf('\n      },\n', at));
  ok(/climbCourse\(\{ pieces: o\.pieces, gap: o\.gap, extras, ropeLands, ropeScale \}\)/.test(body) && /climbCourse\(\{ pieces: o\.pieces, gap: o\.gap, floor, extras, ropeLands, ropeScale \}\)/.test(body), 'the command asks the one layout for its pieces (once for their footprints, once with the floor deep enough for the ground under them)');
  ok(body.includes('const extras = o.extras ?? true;'), "the game's command stands the owner's extra rows (the ladders and the vertical pieces) unless asked not to");
  ok(body.includes("await this.groundCurtain('the climbing course', () => this.standClimbCourse(course, frame), 'the climbing course');"), 'it stands them behind a short curtain (its sweep builds the one program before the screen lifts)');
  const stand = main.slice(main.indexOf('  private standClimbCourse('), main.indexOf('  private dropClimbTest('));
  ok(stand.includes('buildCourseColliders(this.physics.world, course, frame)') && stand.includes('courseTriangles(course, frame, notRopeColumn)'), 'its colliders and its mesh are the builder\'s two answers over the same course and frame');
  ok(!/ColliderDesc|createCollider/.test(stand), 'it makes no collider of its own beside the builder\'s');
  const drop = main.slice(main.indexOf('  private dropClimbTest('), main.indexOf('  private trackById('));
  ok(/this\.physics\.removeCollider\(c\.collider\)/.test(drop) && /this\.world\.forgetMaterials\(\[s\.material\]\)/.test(drop) && /s\.material\.dispose\(\)/.test(drop) && /s\.mesh\.geometry\.dispose\(\)/.test(drop), 'taking it down removes every collider, forgets the material in the world\'s sets and disposes the mesh\'s geometry and material');
  ok(/const cleared = this\.dropClimbTest\('cleared'\);\n\s*if \(o\.clear\) return \{ cleared \};/.test(body), '`{ clear: true }` takes it down (and every call takes the last one down first)');
  const leave = main.slice(main.indexOf('  private leaveTracks('), main.indexOf('  private standClimbCourse('));
  ok(/^ {2}private leaveTracks\(why: string\): void \{\n(?:\s*\/\/[^\n]*\n)*\s*this\.dropClimbTest\(why\);/.test(leave), 'leaving a world takes it down first (`leaveTracks`)');
  ok(["this.leaveTracks('the select screen');", "this.leaveTracks('a new world');", "this.leaveTracks('a jump to another system');"].every((s) => main.includes(s)), 'and the world is left that way at the select screen, an arrival and a jump to another system');
}

console.log(`climbCourse: ${checks} checks passed`);
