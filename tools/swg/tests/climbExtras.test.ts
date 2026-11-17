// The owner's extra rows of the climbing course (2026-11-17: "a section of ladder-like things so I can test hop-ups and
// hop-downs and a vertical portion to the gauntlet that lets me combine a bunch of things"): `climbCourse({ extras: true })`
// lays the ladders, zigzags, shelves, the chimney and the tower after every other row, and leaves the course, its ids and
// so every digest exactly as they were when not asked. Each lip the pieces name stands on a solid's top with open air over
// the hands, each ladder's rungs are their step apart, and every start stands on a floor.
import { climbCourse, courseIds, extraIds, LADDER_RUNGS, type CourseBox, type CoursePiece } from '../../../src/anim/climbCourse.ts';

let checks = 0;
function ok(cond: unknown, what: string): void {
  if (!cond) throw new Error(`climbExtras: ${what}`);
  checks++;
}

// ---- 1. not asked, nothing moves -------------------------------------------------------------------------------------------
{
  const plain = climbCourse();
  ok(JSON.stringify(plain.pieces.map((p) => p.id)) === JSON.stringify(courseIds()), 'the course not asked for its extras is the course its ids name');
  ok(!plain.pieces.some((p) => extraIds().includes(p.id)), 'and holds none of the extra pieces');
  const asked = climbCourse({ extras: true });
  const before = climbCourse();
  const ids = asked.pieces.map((p) => p.id);
  ok(JSON.stringify(ids) === JSON.stringify(courseIds().concat(extraIds())), 'asked, the extras come after every other piece, in their order');
  for (const p of before.pieces) {
    const q = asked.pieces.find((r) => r.id === p.id)!;
    ok(JSON.stringify(q) === JSON.stringify(p), `${p.id} stands where it stood with or without the extras`);
  }
  const lastZ = Math.max(...before.pieces.map((p) => p.at[1] + p.bounds.z1));
  for (const p of asked.pieces.filter((r) => extraIds().includes(r.id))) ok(p.at[1] + p.bounds.z0 > lastZ, `${p.id} stands past the last row of the course`);
  ok(['ladders', 'vertical'].every((r) => asked.pieces.some((p) => p.row === r)), 'two rows of their own: the ladders and the vertical pieces');
  const one = climbCourse({ extras: true, pieces: ['tower'] });
  ok(one.pieces.length === 1 && one.pieces[0].id === 'tower' && !one.unknown.length, 'an extra piece can be stood alone by its id');
}

// ---- 2. each lip on a solid's top, open air over the hands; starts on a floor ------------------------------------------------
function inside(p: CoursePiece, x: number, y: number, z: number): boolean {
  for (const s of p.solids) {
    if (s.kind !== 'box') continue;
    const b = s as CourseBox;
    if (b.turn !== 0) continue;
    if (Math.abs(x - b.mid[0]) < b.half[0] && Math.abs(y - b.mid[1]) < b.half[1] && Math.abs(z - b.mid[2]) < b.half[2]) return true;
  }
  return false;
}
const course = climbCourse({ extras: true });
for (const p of course.pieces.filter((r) => extraIds().includes(r.id))) {
  ok(p.solids.every((s) => s.kind === 'box' && s.turn === 0), `${p.id} is made of upright boxes`);
  for (const l of p.lips) {
    const mx = (l.a[0] + l.b[0]) / 2;
    const mz = (l.a[2] + l.b[2]) / 2;
    const y = l.a[1];
    ok(Math.abs(l.a[1] - l.b[1]) < 1e-9, `${p.id} ${l.name} is level`);
    const ix = mx - l.out[0] * 0.05;
    const iz = mz - l.out[1] * 0.05;
    ok(inside(p, ix, y - 0.05, iz), `${p.id} ${l.name} has solid under its edge`);
    ok(!inside(p, ix, y + 0.05, iz), `${p.id} ${l.name} has open air over the hands`);
    ok(!inside(p, mx + l.out[0] * 0.05, y - 0.05, mz + l.out[1] * 0.05), `${p.id} ${l.name} has open air before its face`);
  }
  for (const s of p.starts) {
    const [x, y, z] = s.at;
    ok(!inside(p, x, y + 0.05, z) && !inside(p, x, y + 1.7, z), `${p.id} start ${s.name} stands in open air`);
    ok(y === 0 || inside(p, x, y - 0.05, z), `${p.id} start ${s.name} stands on its slab or a solid`);
  }
  if (p.numbers.dir === 'ladder' || p.numbers.dir === 'zigzag' || p.numbers.dir === 'shelves') {
    const ys = p.lips.map((l) => l.a[1]);
    const step = p.numbers.step as number;
    for (let k = 1; k < ys.length; k++) ok(Math.abs(ys[k] - ys[k - 1] - step) < 1e-9, `${p.id} rises ${step} m a rung`);
    if (p.numbers.dir === 'ladder') ok(ys.length === LADDER_RUNGS, `${p.id} has ${LADDER_RUNGS} rungs`);
  }
}

// ---- 3. the tower's line, by its own numbers --------------------------------------------------------------------------------
{
  const t = course.pieces.find((p) => p.id === 'tower')!;
  const lip = (n: string) => t.lips.find((l) => l.name === n)!;
  ok(Math.abs(lip('S1').a[1] - lip('A').a[1] - 0.35) < 1e-9 && Math.abs(lip('S2').a[1] - lip('S1').a[1] - 0.35) < 1e-9, 'the tower steps up 0.35 m twice along its first lip');
  ok(Math.abs(lip('U1').a[1] - lip('S2').a[1] - 1.25) < 1e-9 && Math.abs(lip('U2').a[1] - lip('U1').a[1] - 1.25) < 1e-9, 'then hops up 1.25 m twice');
  ok(Math.abs(lip('C').a[0] - lip('U2').b[0] - 2) < 1e-9 && lip('C').a[1] === lip('U2').a[1], 'then 2 m across to C at the same height');
  ok(Math.abs(lip('C2').a[1] - lip('C').a[1] - 5) < 1e-9, 'a 5 m wall over C');
  ok(Math.abs(lip('D').a[0] - lip('C2').b[0] - 2) < 1e-9 && Math.abs(lip('C2').a[1] - lip('D').a[1] - 1.8) < 1e-9, 'then down and right to D, 2 m across and 1.8 m down');
  ok(t.solids.filter((s) => s.role === 'bar').length === 2 && t.solids.some((s) => s.role === 'pole'), 'two bars over the pit and a pole beside its far platform');
}

// ---- 4. the low pieces (the feedback round's duck and lying prone), by their own numbers -----------------------------------
{
  const low = course.pieces.filter((p) => p.row === 'low');
  ok(low.map((p) => p.id).join(' ') === 'duck-1.5 duck-1.2 duck-0.9 tunnel-0.9 crawl-0.6 crawl-0.55', 'the low row: beams at 1.5, 1.2 and 0.9 m, a tunnel at 0.9 m, slabs at 0.6 and 0.55 m');
  for (const p of low) {
    // The piece's own floor slab first, then the one thing over the way.
    const b = p.solids[1] as CourseBox;
    const under = p.numbers.under as number;
    ok(p.solids.length === 2 && p.solids[0].role === 'floor' && Math.abs(b.mid[1] - b.half[1] - under) < 1e-9 && p.lips.length === 0, `${p.id}: one box whose underside is ${under} m over the floor, nothing to grab`);
    ok(!inside(p, 0, under - 0.05, b.mid[2]) && inside(p, 0, under + 0.05, b.mid[2]), `${p.id}: open under it, solid over that`);
  }
}

console.log(`climbExtras: ${checks} checks passed`);
