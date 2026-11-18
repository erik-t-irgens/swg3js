// The owner's extra rows of the climbing course (2026-11-17: "a section of ladder-like things so I can test hop-ups and
// hop-downs and a vertical portion to the gauntlet that lets me combine a bunch of things"): `climbCourse({ extras: true })`
// lays the ladders, zigzags, shelves, the chimney and the tower after every other row, and leaves the course, its ids and
// so every digest exactly as they were when not asked. Each lip the pieces name stands on a solid's top with open air over
// the hands, each ladder's rungs are their step apart, and every start stands on a floor.
import { BEAM_THICK, climbCourse, courseIds, extraIds, HOLD_ROWS, LADDER_RUNGS, TRAVERSE_GAPS, TRAVERSE_RISES, type CourseBox, type CoursePiece } from '../../../src/anim/climbCourse.ts';
import { pieceLabel } from '../../../src/anim/climbLabels.ts';

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
/** The owner's free twins, traverses and climbing walls (2026-11-17), checked in section 5: sloped beams are prisms, not boxes. */
const twin = (id: string): boolean => /^(free-|traverse-|climbwall-)/.test(id);
for (const p of course.pieces.filter((r) => extraIds().includes(r.id) && !twin(r.id))) {
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

// ---- 5. the owner's free twins, traverses and climbing walls (2026-11-17) ----------------------------------------------------
{
  const ours = course.pieces.filter((p) => twin(p.id));
  ok(ours.length > 0 && JSON.stringify(ours.map((p) => p.id)) === JSON.stringify(extraIds().filter(twin)), 'the free twins, traverses and climbing walls come last, in their order');
  ok(['free twins', 'traverses', 'climbing walls'].every((r) => ours.some((p) => p.row === r)), 'in three rows of their own');
  // One free twin of every kind of lip the braced course has.
  for (const kind of ['corner', 'slope', 'steps', 'gap'] as const) ok(ours.some((p) => p.kind === kind && p.numbers.free === true), `a free ${kind}`);
  for (const dir of ['side', 'updown', 'diag', 'behind', 'ladder', 'zigzag']) ok(ours.some((p) => p.numbers.dir === dir && p.numbers.free === true), `a free ${dir} hop`);
  ok(ours.some((p) => p.kind === 'corner' && p.numbers.radius !== undefined), 'a free curve');
  ok(ours.some((p) => p.id === 'traverse-braced') && ours.some((p) => p.id === 'traverse-free'), 'a traverse braced and free');
  ok(['climbwall-braced', 'climbwall-free', 'climbwall-braced-small', 'climbwall-free-small'].every((id) => ours.some((p) => p.id === id)), 'climbing walls braced and free, two hold widths each');
  for (const p of ours) {
    const free = p.numbers.free === true || p.numbers.braced === false;
    for (const l of p.lips) {
      const level = Math.abs(l.a[1] - l.b[1]) < 1e-9;
      if (level) {
        // A level lip on a box: solid under its edge, open air over the hands and before its face.
        const mx = (l.a[0] + l.b[0]) / 2;
        const mz = (l.a[2] + l.b[2]) / 2;
        const y = l.a[1];
        const ix = mx - l.out[0] * 0.05;
        const iz = mz - l.out[1] * 0.05;
        const onBox = inside(p, ix, y - 0.05, iz);
        const onPrism = p.solids.some((s) => s.kind === 'prism' && s.tops.includes(y));
        ok(onBox || onPrism, `${p.id} ${l.name} has solid under its edge`);
        if (onBox) {
          ok(!inside(p, ix, y + 0.05, iz), `${p.id} ${l.name} has open air over the hands`);
          ok(!inside(p, mx + l.out[0] * 0.05, y - 0.05, mz + l.out[1] * 0.05), `${p.id} ${l.name} has open air before its face`);
          // Free: nothing a body's legs could brace on just under the beam (a braced lip has its wall there).
          if (free && l.name !== 'top') ok(!inside(p, ix, y - 0.35, iz), `${p.id} ${l.name} hangs free (nothing under its beam)`);
          if (!free && l.name !== 'top' && p.kind !== 'wall') ok(inside(p, ix, y - 0.35, iz), `${p.id} ${l.name} is braced (its wall under it)`);
        }
      } else {
        // A sloped lip is a beam prism's top edge exactly, its underside the beam's thickness under it all along.
        const s = p.solids.find((q) => q.kind === 'prism' && q.foot[0][0] === l.a[0] && q.foot[0][1] === l.a[2] && q.foot[1][0] === l.b[0] && q.foot[1][1] === l.b[2]);
        ok(s && s.kind === 'prism' && s.tops[0] === l.a[1] && s.tops[1] === l.b[1], `${p.id} ${l.name}: a sloped lip is its beam's top edge`);
        if (s && s.kind === 'prism') ok(s.bottoms && s.bottoms.every((b, i) => Math.abs(s.tops[i] - b - BEAM_THICK) < 1e-9), `${p.id} ${l.name}: its underside slopes with it, ${BEAM_THICK} m under`);
      }
    }
    for (const s of p.solids) if (s.role === 'beam') ok(s.kind === 'box' ? Math.abs(2 * s.half[1] - BEAM_THICK) < 1e-9 && Math.min(2 * s.half[0], 2 * s.half[2]) > 0.12 : true, `${p.id}: a beam is ${BEAM_THICK} m thick and thicker than phase 3's bars`);
    for (const st of p.starts) {
      const [x, y, z] = st.at;
      ok(!inside(p, x, y + 0.05, z) && !inside(p, x, y + 1.7, z), `${p.id} start ${st.name} stands in open air`);
    }
  }
  // The traverse by its own numbers: each lip 2 m, the gaps and the rises as named.
  for (const id of ['traverse-braced', 'traverse-free']) {
    const t = ours.find((p) => p.id === id)!;
    const lips = [...t.lips].sort((a, b) => a.a[0] - b.a[0]);
    ok(lips.length === TRAVERSE_RISES.length, `${id}: ${TRAVERSE_RISES.length} lips`);
    for (let k = 0; k < lips.length; k++) {
      ok(Math.abs(lips[k].b[0] - lips[k].a[0] - 2) < 1e-9 && Math.abs(lips[k].a[1] - lips[0].a[1] - TRAVERSE_RISES[k]) < 1e-9, `${id} T${k}: 2 m long, ${TRAVERSE_RISES[k]} m over the first`);
      if (k > 0) ok(Math.abs(lips[k].a[0] - lips[k - 1].b[0] - TRAVERSE_GAPS[k - 1]) < 1e-9, `${id}: ${TRAVERSE_GAPS[k - 1]} m between T${k - 1} and T${k}`);
    }
  }
  // Every climbing wall's hold above the first row has one under it within the ladder's reach (1.2 m up, 2 m across), so
  // the wall can be climbed hand to hand from the bottom; and its top is in reach of its highest holds.
  for (const w of ours.filter((p) => p.numbers.holds !== undefined)) {
    const holds = w.lips.filter((l) => l.name !== 'top');
    const mid = (l: (typeof holds)[number]): number => (l.a[0] + l.b[0]) / 2;
    ok(holds.length === w.numbers.holds && holds.length > HOLD_ROWS * 3, `${w.id}: ${holds.length} holds`);
    const low = Math.min(...holds.map((l) => l.a[1]));
    for (const h of holds) {
      if (h.a[1] - low < 0.5) continue;
      ok(holds.some((g) => g !== h && h.a[1] - g.a[1] > 0.3 && h.a[1] - g.a[1] <= 1.2 && Math.abs(mid(h) - mid(g)) <= 2 + 1e-9),`${w.id} ${h.name} has a hold under it in reach`);
    }
    const top = w.lips.find((l) => l.name === 'top')!;
    ok(holds.some((h) => top.a[1] - h.a[1] <= 1.2), `${w.id}: the top is in reach of its highest holds`);
    ok(Math.abs(Math.max(...holds.map((l) => l.b[0] - l.a[0])) - (w.numbers.holdWidth as number)) < 1e-9, `${w.id}: holds ${w.numbers.holdWidth} m wide`);
  }
  // The same layout every time (the holds' nudges are a fixed hash).
  ok(JSON.stringify(climbCourse({ extras: true, pieces: ['climbwall-braced'] }).pieces[0].lips) === JSON.stringify(climbCourse({ extras: true, pieces: ['climbwall-braced'] }).pieces[0].lips), 'a climbing wall stands the same holds every time');
}

// ---- 6. every piece has a label saying what it is and what to try ----------------------------------------------------------
for (const p of course.pieces) {
  const l = pieceLabel(p);
  ok(l.title.length > 0 && l.what.length > 0 && l.title !== p.id && !l.title.includes('undefined') && !l.what.includes('undefined') && !l.title.includes('NaN'), `${p.id} is labelled (${l.title} / ${l.what})`);
}
ok(pieceLabel(course.pieces.find((p) => p.id === 'free-slope-25')!).title.startsWith('Free'), 'a free twin says it is free');
ok(pieceLabel(course.pieces.find((p) => p.id === 'slope-25')!).title.startsWith('Braced'), 'and its braced one says braced');

console.log(`climbExtras: ${checks} checks passed`);
