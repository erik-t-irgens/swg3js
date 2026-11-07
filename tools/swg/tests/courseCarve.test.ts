// The race drawer's second wave: the carve's own rules (`src/swg/terrain/courseCarve.ts`, DESIGN.md §2.5, §2.6). The
// road is its surface exactly; the shoulder is `generator.ts`'s own feather (each of the four, a wrong function failing);
// the bank lifts the driver's right; an open end's round cap and a joined end's none; `sh` 0 a step. The blend: a figure
// eight's lower road wins in its slot, `wall` stands an abutment at `hw + margin` and `slope` makes a cutting over the lower
// shoulder; a climbing hairpin and two parallel roads (their road legs apart) show no cliff between their edges, where the
// first version's rule ("the lowest surface wins wherever reaches meet") put the whole rise in one pole; a hairpin whose
// legs overlap at different heights is carved through, and the higher leg's shoulder never spills onto the lower road;
// level passes blend with no crease, and a pair whose difference crosses `level` along the road has no step (smoothstep).
// Two tracks carve the same whichever is first in the file; the shortcuts permuted and a closed path's nodes rotated give
// the same bits. The deck answers the upper road over a lower slot and -Infinity at a flat crossing. The dirty set of every
// kind of edit holds every pole that moved and names exactly the edges whose samples differ. The buckets and the edge
// arrays are made again only when outgrown. And the cost of a block wholly under a road, measured, held as a bound.
//
// Run: node tools/swg/tests/courseCarve.test.ts
import assert from 'node:assert/strict';
import { CourseCarve, carveAsk, deckAsk, bandShare, foldCourseRect, CARVE_GAMMA, type CarveRect, type CarveTrack } from '../../../src/swg/terrain/courseCarve.ts';
import { feather } from '../../../src/swg/terrain/generator.ts';
import { buildSpine, sameEdge } from '../../../src/race/coursePath.ts';
import { figureEight, hairpin, node, parallel, straight, track, withShortcuts } from './carveFixtures.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);

const store = (tracks: CarveTrack[]): CourseCarve => {
  const s = new CourseCarve();
  s.set(tracks);
  return s;
};

/**
 * A warm preview `set()` (prune off) of a long course at positive raw x and z, where the bucket keys of before were past a
 * small integer and every append boxed one: a 400-node circuit 2 km in radius about (6000, 6000), one node moved a tick
 * (two prepared courses in turn, so the loop makes nothing of its own), the young generation read before and after each
 * set, only sets with no collection inside them kept, the median answered in KB. Run in a process of its own with a young
 * generation large enough that most sets see no collection (`COURSE_SET_MEASURE`).
 */
async function measureSet(): Promise<void> {
  const { getHeapSpaceStatistics } = await import('node:v8');
  const young = (): number => {
    for (const s of getHeapSpaceStatistics()) if (s.space_name === 'new_space') return s.space_used_size;
    return 0;
  };
  const ring = (moved: number): CarveTrack => {
    const nodes = [];
    for (let k = 0; k < 400; k++) {
      const a = (k / 400) * Math.PI * 2;
      nodes.push(node(6000 + Math.cos(a) * 2000 + (k === 0 ? moved : 0), 6000 + Math.sin(a) * 2000, 10 + 3 * Math.sin(a * 5), { w: 16, sh: 8 }));
    }
    return track('long', 'circuit', [{ id: 'main', nodes }]);
  };
  const a = [ring(0)];
  const b = [ring(1.5)];
  const s = new CourseCarve();
  for (let k = 0; k < 20; k++) s.set(k & 1 ? b : a, false);
  const kept: number[] = [];
  for (let k = 0; k < 60; k++) {
    const before = young();
    s.set(k & 1 ? a : b, false);
    const after = young();
    if (after >= before) kept.push(after - before);
  }
  kept.sort((p, q) => p - q);
  console.log(JSON.stringify({ sets: kept.length, kb: kept.length ? kept[kept.length >> 1] / 1024 : -1 }));
}
if (process.env.COURSE_SET_MEASURE === '1') {
  await measureSet();
  process.exit(0);
}
/** Every pole of a rectangle laid (raw `raw` everywhere), the array answered. */
function lay(s: CourseCarve, x0: number, z0: number, nx: number, nz: number, step: number, raw: number | ((x: number, z: number) => number) = 0): Float32Array {
  const a = carveAsk();
  a.raw = new Float32Array(nx * nz);
  a.out = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) a.raw[j * nx + i] = typeof raw === 'number' ? raw : raw(x0 + i * step, z0 + j * step);
  a.x0 = x0;
  a.dx = step;
  a.z0 = z0;
  a.dz = step;
  a.nx = nx;
  a.nz = nz;
  a.widen = 0;
  s.layIn(a);
  return a.out;
}
const sameBits = (a: Float32Array, b: Float32Array): boolean => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
/** The greatest difference between neighbouring poles along a line of z at `x` (2 m apart). */
function steepest(s: CourseCarve, x: number, z0: number, z1: number, raw: number): number {
  let prev = s.carveAt(raw, x, z0);
  let m = 0;
  for (let z = z0 + 2; z <= z1; z += 2) {
    const v = s.carveAt(raw, x, z);
    m = Math.max(m, Math.abs(v - prev));
    prev = v;
  }
  return m;
}
const wide = (ts: CarveTrack[], w: number): CarveTrack[] => ts.map((t) => ({ ...t, course: { ...t.course!, paths: t.course!.paths.map((p) => ({ ...p, nodes: p.nodes.map((n) => ({ ...n, w })) })) } }));

// ---------------------------------------------------------------- 1. the road, the bank, the shoulder, the ends

{
  const s = store([straight('s', -100, 100, 0, 10.3, { w: 12, sh: 8 })]);
  const out = lay(s, -20, -4, 21, 5, 2, 0);
  ok(out.every((v) => Object.is(v, Math.fround(10.3))), 'every pole on the road is its surface exactly, as a float32 holds it (fround)');
  ok(Object.is(s.carveAt(0, 37.5, -2.25), 10.3), 'and read in doubles the surface itself');
  const b = store([straight('s', -100, 100, 0, 10.3, { w: 12, sh: 8, b: 6 })]);
  const tb = Math.tan((6 * Math.PI) / 180);
  ok(Math.abs(b.carveAt(0, 0, -4) - (10.3 + 4 * tb)) < 1e-12 && Math.abs(b.carveAt(0, 0, 4) - (10.3 - 4 * tb)) < 1e-12, `a bank of 6° lifts the driver's right (-z of a road running +x) by o tan b (${(b.carveAt(0, 0, -4) - 10.3).toFixed(4)} m at 4 m) and lowers the left`);
  // The shoulder: each of the client's four falloffs, at 30% of the way out.
  const names = ['linear', 'easeIn', 'easeOut', 'easeInOut'];
  for (let fn = 0; fn < 4; fn++) {
    const f = store([straight('s', -100, 100, 0, 10, { w: 12, sh: 8 }, { feather: names[fn] })]);
    const d = 6 + 8 * 0.3;
    const got = f.carveAt(2, 0, d);
    const want = 2 + (10 - 2) * feather(fn, 0.7);
    const others = [0, 1, 2, 3].filter((g) => g !== fn).every((g) => Math.abs(got - (2 + (10 - 2) * feather(g, 0.7))) > 1e-3);
    ok(Math.abs(got - want) < 1e-12 && others, `the shoulder is generator.ts's own ${names[fn]} falloff (${got.toFixed(4)} at 30% out over a raw 2), no other of the four`);
  }
  // A banked road's shoulder carries its near edge's height.
  const half = feather(3, 0.5);
  ok(Math.abs(b.carveAt(0, 0, -10) - (10.3 + 6 * tb) * half) < 1e-12 && Math.abs(b.carveAt(0, 0, 10) - (10.3 - 6 * tb) * half) < 1e-12, "a banked road's shoulder ramps to its near edge's height, the right's raised and the left's lowered");
  // The open end's round cap.
  const e = store([straight('s', -100, 100, 0, 10, { w: 12, sh: 8 })]);
  ok(Object.is(e.carveAt(0, 104, 0), 10) && Object.is(e.carveAt(0, 103, 3), 10), 'an open end is capped round: within the half width of the end node, road');
  ok(e.carveAt(0, 104.5, 4.5) < 10 && e.carveAt(0, 104.5, 4.5) > 0, "past the half width from the end node, a shoulder (the cap is round, not the road's square end)");
  // `sh` 0: a step.
  const st = store([straight('s', -100, 100, 0, 10, { w: 12, sh: 0 })]);
  ok(Object.is(st.carveAt(3, 0, 5.99), 10) && Object.is(st.carveAt(3, 0, 6.01), 3), 'a shoulder of nought is a step at the road\'s edge');
  // A joined end has no cap: past a shortcut's joined end only the road it joins answers.
  const j = store([withShortcuts()]);
  let joinedCap = false;
  for (let k = 0, n = j.passesAt(0, -210); k < n; k++) if (CourseCarve.pathOf(j.passAt(k)) === 'cut_a') joinedCap = true;
  const open = withShortcuts();
  for (const p of open.course!.paths) for (const n of p.nodes) delete (n as { j?: string }).j;
  const o = store([open]);
  let openCap = false;
  for (let k = 0, n = o.passesAt(0, -210); k < n; k++) if (CourseCarve.pathOf(o.passAt(k)) === 'cut_a') openCap = true;
  ok(!joinedCap && openCap, 'a joined end has no cap (past it the main road answers), the same end unjoined has one');
}

// ---------------------------------------------------------------- 2. where passes meet

{
  const e8 = store([figureEight('eight', 8)]);
  ok(Object.is(e8.carveAt(5, 0, 0), 0), "a figure eight's lower road wins in its slot: at the crossing the ground is the lower road's surface");
  const t7 = 7 / Math.SQRT2;
  const t9 = 9 / Math.SQRT2;
  ok(Object.is(e8.carveAt(5, t7, -t7), 0), 'and all through its slot (hw + margin) along the upper road');
  ok(Object.is(e8.carveAt(5, t9, -t9), 8), "with `wall`, just past the lower slot along the upper road the ground is the upper road's own: an abutment, the lower shoulder dropped");
  const sl = store([figureEight('eight', 8, { crossing: 'slope' })]);
  const v = sl.carveAt(5, t9, -t9);
  ok(v > 3 && v < 7.5, `with \`slope\` the lower shoulder is kept there: a cutting rising toward the upper road (${v.toFixed(2)} m against its 8)`);
  const d = deckAsk();
  d.x = 0;
  d.z = 0;
  e8.deckOf(d);
  ok(d.out === 8, `the deck at the crossing is the upper road over the lower slot (${d.out})`);
  const flat = store([straight('a', -100, 100, 0, 4), track('b', 'sprint', [{ id: 'main', nodes: [node(0, -100, 4, { c: 'straight' }), node(0, 100, 4, { c: 'straight' })] }])]);
  const f = deckAsk();
  f.x = 0;
  f.z = 0;
  flat.deckOf(f);
  ok(f.out === -Infinity && Object.is(flat.carveAt(0, 0, 0), 4) && Object.is(flat.carveAt(0, 3, 3), 4), 'at a flat crossing there is no deck, and the level passes blend to their one surface with no crease');
  // One path crossing itself: asked for one leg (a pass named, the tracker's place along the path), only that leg gives a
  // deck. Filtered by track and path alone, the lower leg read the upper leg's deck.
  let upper = -1;
  let lower = -1;
  for (let k = 0, n = e8.passesAt(0, 0); k < n; k++) {
    const p = e8.passAt(k);
    if (CourseCarve.pathOf(p) !== 'main') continue;
    if (p.T > 4) upper = e8.arcOf(p);
    else lower = e8.arcOf(p);
  }
  const leg = (arc: number, edge: number): number => {
    const q = deckAsk();
    q.x = 0;
    q.z = 0;
    q.track = 'eight';
    q.path = 'main';
    q.edge = edge;
    q.arc = arc;
    e8.deckOf(q);
    return q.out;
  };
  ok(upper >= 0 && lower >= 0 && leg(upper, 1) === 8 && leg(lower, 4) === -Infinity, `asked for one leg of a figure eight, the upper leg reads its deck (8) and the lower leg none (${leg(lower, 4)})`);
  ok(leg(lower + 30, 4) === -Infinity && leg(upper - 30, 1) === 8, 'and a place along the path a little off either leg (the far ray ahead, a footprint across a node) still names that leg');
}

{
  // A bucket's key is a small integer whatever the sign of the cell (an append and a lookup box nothing) and reads back as
  // its cell; a road past the range carves nothing there and throws nothing.
  const far = store([straight('far', -230000, -229800, -5900, 4), straight('pos', 229800, 230000, 5900, 4)]);
  const keys = [...(far as unknown as { buckets: Map<number, Int32Array> }).buckets.keys()];
  const cells = far.cells();
  ok(keys.length > 0 && keys.every((k) => Number.isInteger(k) && k >= 0 && k < 2 ** 30), `every bucket's key is a small integer (${keys.length} keys, the largest ${Math.max(...keys)})`);
  const under = (cx: number, cz: number, sx: number): boolean => Math.abs(cx * 16 + 8 - sx * 229900) < 160 && Math.abs(cz * 16 + 8 - sx * 5900) < 60;
  ok(cells.length > 0 && cells.every(([cx, cz]) => under(cx, cz, 1) || under(cx, cz, -1)) && cells.some(([cx]) => cx < 0) && cells.some(([cx]) => cx > 0), 'and every key reads back as a cell under its own road, on both signs');
  ok(Object.is(far.carveAt(1, -229900, -5900), 4) && Object.is(far.carveAt(1, 229900, 5900), 4), 'and both roads carve where they stand');
  const out = store([straight('out', 300000, 300100, 0, 4)]);
  ok(out.cells().length === 0 && Object.is(out.carveAt(1, 300050, 0), 1), 'a road past the range (300 km out) is filed nowhere and carves nothing, with nothing thrown');
  // A warm preview set of a long course at positive raw x and z: its bucket appends box nothing, so what is left is the
  // spine's own (measured about 95 KB a set; with the keys of before, every append boxed one: about 1.5 MB).
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const r = spawnSync(process.execPath, ['--min-semi-space-size=64', '--max-semi-space-size=64', fileURLToPath(import.meta.url)], { env: { ...process.env, COURSE_SET_MEASURE: '1' }, encoding: 'utf8', timeout: 300000 });
  const m = /\{"sets":\d+,"kb":-?[\d.]+\}/.exec(r.stdout ?? '');
  const got = m ? (JSON.parse(m[0]) as { sets: number; kb: number }) : { sets: 0, kb: -1 };
  ok(got.sets >= 20 && got.kb >= 0 && got.kb < 400, `a warm preview set of a 400-node, 12.6 km circuit at positive raw x and z makes about ${got.kb.toFixed(0)} KB (the median of ${got.sets} sets with no collection inside them; bound 400 KB, where boxed keys made about 1.5 MB)`);
}

{
  // Climbing hairpin and parallel roads 30 m apart, 5 m apart in height, on 8 m easeInOut shoulders.
  const rise = 5;
  // Where the shoulders meet but the road edges stand a shoulder apart (16 m roads, edges 14 m apart): §4's criterion holds,
  // no step between neighbouring poles more than one shoulder's own slope allows (the largest 2 m chord of its falloff
  // times the most it carries, |edge - raw|), on both pole lattices (the edges on poles and between them).
  const chord = (() => {
    let m = 0;
    for (let u = 0; u + 0.25 <= 1 + 1e-12; u += 1 / 64) m = Math.max(m, feather(3, Math.min(1, u + 0.25)) - feather(3, u));
    return m;
  })();
  let within = true;
  let w16 = 0;
  for (const roads of [store(wide(parallel(30, rise), 16)), store(wide([hairpin('pin', rise, 30)], 16))])
    for (const raw of [0, 2.5, -3, 8])
      for (const z0 of [-30, -29]) {
        const s = steepest(roads, 0, z0, 60, raw);
        w16 = Math.max(w16, s);
        if (s > chord * Math.max(Math.abs(0 - raw), Math.abs(rise - raw)) + 1e-6) within = false;
      }
  ok(within, `with 16 m roads (their edges a shoulder apart) no step between neighbouring poles passes one shoulder's own slope for the raw ground under it (worst ${w16.toFixed(3)} m over 2 m), on both lattices`);
  // At the tool's own 24 m width the edges stand only 6 m apart and the blend's shares (w^γ, γ ${CARVE_GAMMA}, §2.6 rule 3) put
  // most of the rise in one step: the design's own rule worked out by hand at the two poles either side of the gap's middle
  // (neither on a road, no slot crossed: the blend alone), held to the store to the bit. The design's criterion cannot hold
  // there (a 5 m rise across 6 m needs at least 1.67 m a pole step), which W2-notes records as a deviation for the owner.
  const par = store(wide(parallel(30, rise), 24));
  const pin = store(wide([hairpin('pin', rise, 30)], 24));
  const handAt = (raw: number, z: number): number => {
    const wl = feather(3, 1 - (z - 12) / 8);
    const wh = feather(3, 1 - (18 - z) / 8);
    const sl = wl ** CARVE_GAMMA;
    const shh = wh ** CARVE_GAMMA;
    const T = (shh * rise) / (sl + shh);
    const W = Math.max(wl, wh);
    return raw + (T - raw) * W;
  };
  let handBad = '';
  for (const raw of [0, 2.5, -3, 8])
    for (const z of [14, 16])
      for (const [name, s] of [['parallel', par], ['hairpin', pin]] as const) if (Math.abs(s.carveAt(raw, 0, z) - handAt(raw, z)) > 1e-9) handBad ||= `${name} raw ${raw} z ${z}: ${s.carveAt(raw, 0, z)} against ${handAt(raw, z)}`;
  const handStep = handAt(0, 16) - handAt(0, 14);
  let worst = 0;
  for (const raw of [0, 2.5, -3, 8]) worst = Math.max(worst, steepest(par, 0, -30, 60, raw), steepest(pin, 0, -30, 60, raw));
  ok(!handBad && Math.abs(worst - handStep) < 1e-9 && worst < rise, `at 24 m the carve is §2.6's blend worked by hand at the gap's poles (raw 0, 2.5, -3, 8), its steepest step that blend's own ${handStep.toFixed(4)} m and never the whole ${rise} m cliff${handBad ? ` (${handBad})` : ''}`);
  note(`at the tool's own 24 m width two roads 30 m apart step ${worst.toFixed(2)} m over 2 m between their edges, where one shoulder alone carrying the ${rise} m steps ${(chord * rise).toFixed(2)} m: a deviation from §4's criterion (W2-notes), the blend's γ and the default width the owner's to weigh`);
  // On each road, its surface (the higher shoulder never spills onto the lower road).
  ok(Object.is(par.carveAt(2.5, 0, 11.9), 0) && Object.is(par.carveAt(2.5, 0, 18.1), rise), 'each road keeps its surface to its edge');
  // A hairpin whose legs overlap at different heights is carved through: the lower leg's road all across it, a wall at its slot.
  const over = store(wide([hairpin('pin', rise, 20)], 24));
  let lowerExact = true;
  for (let z = 0; z <= 14; z += 2) if (!Object.is(over.carveAt(2.5, 0, z), 0)) lowerExact = false;
  ok(lowerExact && Object.is(over.carveAt(2.5, 0, 16), rise), "a hairpin whose legs overlap at different heights is carved through: the lower leg's surface across its slot, then the higher leg's road (an abutment)");
  ok(Object.is(over.carveAt(2.5, 0, 4), 0) && Object.is(over.carveAt(2.5, 0, 6), 0), "and the higher leg's shoulder never spills onto the lower road");
}

{
  // A pair whose difference crosses `level` along the road: two 12 m roads 8 m apart (their roads overlapping by 4 m), one
  // flat and one climbing 2 m over 400 m. Along the overlap the rule fades in over the band: no step between poles.
  const a = straight('a', -200, 200, 0, 0);
  const b = track('b', 'sprint', [{ id: 'main', nodes: [node(-200, 8, 0, { c: 'straight' }), node(200, 8, 2, { c: 'straight' })] }]);
  const s = store([a, b]);
  let m = 0;
  let prev = s.carveAt(0, -190, 4);
  for (let x = -188; x <= 190; x += 2) {
    const v = s.carveAt(0, x, 4);
    m = Math.max(m, Math.abs(v - prev));
    prev = v;
  }
  ok(m < 0.05, `two roads whose difference crosses \`level\` along their overlap change by at most ${m.toFixed(4)} m between poles 2 m apart (the rules fade in by smoothstep over level / 2 to level)`);
  ok(bandShare(0.25, 1) === 0 && bandShare(1, 1) === 1 && bandShare(0.75, 1) === 0.5 && bandShare(0.1, 0) === 1, 'the band: nought under half the level, all past it, a half in the middle; with no band a step past nought');
}

// ---------------------------------------------------------------- 3. order-free

{
  const e = figureEight('eight', 8);
  const x = straight('cross', -300, 300, 40, 3, { w: 16 });
  const A = lay(store([e, x]), -200, -120, 201, 121, 2, (px, pz) => Math.sin(px * 0.05) * 3 + pz * 0.01);
  const B = lay(store([x, e]), -200, -120, 201, 121, 2, (px, pz) => Math.sin(px * 0.05) * 3 + pz * 0.01);
  ok(sameBits(A, B), 'two tracks crossing carve the same bits whichever is first in the file');
  const ab = lay(store([withShortcuts('loop', 'ab', 0)]), -230, -230, 231, 231, 2, 1.5);
  const ba = lay(store([withShortcuts('loop', 'ba', 0)]), -230, -230, 231, 231, 2, 1.5);
  const rot = lay(store([withShortcuts('loop', 'ab', 2)]), -230, -230, 231, 231, 2, 1.5);
  const rot1 = lay(store([withShortcuts('loop', 'ab', 1)]), -230, -230, 231, 231, 2, 1.5);
  ok(sameBits(ab, ba), 'the shortcuts permuted give the same bits');
  ok(sameBits(ab, rot) && sameBits(ab, rot1), "a closed path's nodes rotated give the same bits");
}

// ---------------------------------------------------------------- 4. the dirty set

{
  const base = figureEight('eight', 8);
  const edits: [string, CarveTrack[]][] = [];
  const moved = figureEight('eight', 8);
  moved.course!.paths[0].nodes[2] = { ...moved.course!.paths[0].nodes[2], x: 96, z: -84 };
  edits.push(['a node moved', [moved]]);
  const widened = figureEight('eight', 8);
  widened.course!.paths[0].nodes[4] = { ...widened.course!.paths[0].nodes[4], w: 20 };
  edits.push(['a node widened', [widened]]);
  edits.push(['the falloff changed', [figureEight('eight', 8, { feather: 'linear' })]]);
  edits.push(['a track added', [base, straight('cross', -300, 300, 40, 3)]]);
  edits.push(['every track taken out', []]);
  for (const [what, after] of edits) {
    const s = store([base]);
    const n = s.set(after);
    const rects = s.rects.slice(0, n).map((r) => ({ ...r }));
    const was = store([base]);
    const now = store(after);
    let missed = 0;
    let moves = 0;
    for (let z = -260; z <= 260; z += 4)
      for (let x = -300; x <= 300; x += 4) {
        const raw = 1 + x * 0.003;
        if (Object.is(was.carveAt(raw, x, z), now.carveAt(raw, x, z))) continue;
        moves++;
        if (!rects.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1)) missed++;
      }
    // The edges whose samples differ, old and new (a path's own numbers moved: all of them).
    let want = 0;
    const bp = buildSpine(base.course!.paths[0].nodes, true);
    if (what === 'a node moved' || what === 'a node widened') {
      const ap = buildSpine(after[0].course!.paths[0].nodes, true);
      for (let e = 0; e < Math.max(bp.edges.length, ap.edges.length); e++) if (!(bp.edges[e] && ap.edges[e] && sameEdge(bp.edges[e], ap.edges[e]))) want += (bp.edges[e] ? 1 : 0) + (ap.edges[e] ? 1 : 0);
    } else if (what === 'the falloff changed') want = 2 * bp.edges.length;
    else if (what === 'a track added') want = buildSpine(after[1].course!.paths[0].nodes, false).edges.length;
    else want = bp.edges.length;
    ok(missed === 0 && moves > 0 && n === want, `${what}: ${moves} poles moved and every one is in the dirty set, ${n} rectangles, exactly the edges whose samples differ (${want})`);
  }
}

// ---------------------------------------------------------------- 5. made again only when outgrown

{
  const s = store([figureEight('eight', 8)]);
  const buckets = (s as unknown as { buckets: Map<number, Int32Array> }).buckets;
  const first = new Map(buckets);
  s.set([figureEight('eight', 8)], false);
  // The second spine (the first change's), whose arrays the change after next is built into.
  const x0 = s.spines()[0].spine.edges[0].x;
  let same = 0;
  for (const [k, a] of first) if (buckets.get(k) === a) same++;
  ok(same === first.size && buckets.size === first.size, `a course set again with the same numbers refills every bucket in place (${same} of ${first.size})`);
  const moved = figureEight('eight', 8);
  moved.course!.paths[0].nodes[2] = { ...moved.course!.paths[0].nodes[2], x: 92 };
  s.set([moved], false);
  s.set([figureEight('eight', 8)], false);
  ok(s.spines()[0].spine.edges[0].x === x0, "a path's spine is double buffered: two changes on, the arrays of the spine two changes back are built into again");
  let kept = 0;
  for (const [k, a] of first) if (buckets.get(k) === a) kept++;
  ok(kept === first.size, `and a drag's preview (prune off) back where it began holds every bucket it had (${kept} of ${first.size})`);
}

// ---------------------------------------------------------------- 6. the cost, measured

{
  const s = store([straight('wide', -500, 500, 0, 10, { w: 80, sh: 16 })]);
  const a = carveAsk();
  const n = 34;
  a.raw = new Float32Array(n * n);
  a.out = new Float32Array(n * n);
  a.x0 = -32;
  a.dx = 2;
  a.z0 = -32;
  a.dz = 2;
  a.nx = n;
  a.nz = n;
  a.widen = 0;
  for (let k = 0; k < 200; k++) s.layIn(a);
  const runs = 2000;
  const t0 = performance.now();
  for (let k = 0; k < runs; k++) s.layIn(a);
  const ms = (performance.now() - t0) / runs;
  ok(a.out.every((v) => v === 10), 'a block wholly under a road is the road');
  ok(ms < 4, `the cost of laying a block wholly under an 80 m road (34 x 34 poles): ${ms.toFixed(3)} ms (measured about 0.7 ms on the pass's machine; bound 4 ms)`);
  // A pole no bucket names costs one lookup.
  const far = carveAsk();
  far.raw = new Float32Array(n * n);
  far.out = new Float32Array(n * n);
  far.x0 = 5000;
  far.dx = 2;
  far.z0 = 5000;
  far.dz = 2;
  far.nx = n;
  far.nz = n;
  far.widen = 0;
  const t1 = performance.now();
  for (let k = 0; k < runs; k++) s.layIn(far);
  const msFar = (performance.now() - t1) / runs;
  ok(msFar < 0.2, `and a block no road reaches: ${msFar.toFixed(4)} ms`);
}

// The blend's shares (§2.6 rule 3, γ 4): a strong road beats a faint shoulder, two shoulders of like weight meet halfway.
// Two level roads (0.4 m apart in height, under half the level, so neither rule fires) 16 m apart: a pole on the lower
// road's line 4 m from its edge stands in the other's shoulder at a weight of easeInOut(1/4); its share of the blend is that
// weight's fourth power against the road's 1 (`CARVE_GAMMA`), near nothing, where a share by weight alone would lift the
// road by a fifth of the difference.
{
  const s = store([straight('a', -200, 200, 0, 0), straight('b', -200, 200, 16, 0.4)]);
  const w = feather(3, 0.25);
  const share = w ** CARVE_GAMMA / (1 + w ** CARVE_GAMMA);
  const at = s.carveAt(0, 0, 4);
  ok(CARVE_GAMMA === 4 && Math.abs(at - share * 0.4) < 1e-6 && at < 0.01, `a road beats a faint level shoulder over it: ${at.toFixed(5)} m off its surface (its share ${share.toExponential(2)} at a weight of ${w.toFixed(3)})`);
  // Halfway between, both shoulders at one weight: the mean of their surfaces.
  const mid = s.carveAt(0, 0, 8);
  const wm = feather(3, 0.75);
  ok(Math.abs(mid - 0.2 * wm) < 1e-6, `two shoulders of like weight meet halfway (${mid.toFixed(5)} m over a raw 0, the surfaces' mean 0.2 at a weight of ${wm.toFixed(3)})`);
}

{
  // A change's rectangles kept for its end (`foldCourseRect`, the world's list): a held drag's tick after tick of one edge
  // folds into one rectangle, two stretches apart stay two (never their union), every rectangle handed in stays inside a
  // kept one, and the list's records are reused once it is emptied.
  const rects: CarveRect[] = [];
  let n = 0;
  const handed: CarveRect[] = [];
  for (let k = 0; k < 60; k++) {
    const q = { x0: 100 + k * 0.4, z0: -40, x1: 260 + k * 0.4, z1: 40 };
    handed.push({ ...q });
    n = foldCourseRect(rects, n, q);
  }
  ok(n === 1 && rects[0].x0 === 100 && rects[0].x1 === 260 + 59 * 0.4, `a held drag's 60 ticks of one edge are one rectangle (${n})`);
  const far = { x0: -900, z0: -40, x1: -740, z1: 40 };
  handed.push({ ...far });
  n = foldCourseRect(rects, n, far);
  const across = { x0: 120, z0: 300, x1: 280, z1: 380 };
  handed.push({ ...across });
  n = foldCourseRect(rects, n, across);
  ok(n === 3 && rects.slice(0, n).every((r) => (r.x1 - r.x0) * (r.z1 - r.z0) < 200 * 120), `two stretches apart, and one beside it across a gap, are rectangles of their own, never their union (${n})`);
  ok(handed.every((q) => rects.slice(0, n).some((r) => r.x0 <= q.x0 && r.z0 <= q.z0 && r.x1 >= q.x1 && r.z1 >= q.z1)), 'every rectangle handed in stays inside a kept one');
  const held = rects.length;
  const kept = rects.slice();
  n = 0;
  for (const q of [far, across, { x0: 0, z0: 0, x1: 10, z1: 10 }]) n = foldCourseRect(rects, n, { ...q });
  ok(n === 3 && rects.length === held && rects.every((r, i) => r === kept[i]), 'emptied and filled again, the list makes no record (its own are written over)');
}

console.log(`\ncourseCarve: ${checks} checks passed`);
