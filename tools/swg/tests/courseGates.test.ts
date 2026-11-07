// The gates a drawn course places for you (src/race/courseGates.ts, DESIGN.md §2.9): a circuit's gate 0 at node 0 and a
// sprint's `gridAhead` along with its grid at node 0 and on the road; a gate every `gateEvery` and at every turn past
// `gateTurn`, none nearer than `gateMin`; each on the road at `gateLift`, facing along it, rolled by the bank with its heading
// unchanged and its right side up, its width the road's unless `ow`; `h` the pod gate's where pods race; under a deck held
// under it; an apex gate stays on its apex when an earlier edge is lengthened (where a global arclength would slide it) and
// anchors carried through an insert and a delete; following gates placed again and pinned ones not; every placed track read
// by `readTrack` with no refusal.
//
// Run: node tools/swg/tests/courseGates.test.ts
import assert from 'node:assert/strict';
import { readTrack, type TrackDef } from '../../../src/race/trackFile.ts';
import { buildSpine, nearestOn, spineAt, spineNear, spinePoint } from '../../../src/race/coursePath.ts';
import { alongOf, followCourse, followGate, gateAlongs, gateHeightFor, gateRules, placeGates, roadTurn, turnApexes, type GateRules } from '../../../src/race/courseGates.ts';
import { bakeGate, GATE_STRIDE, gateCorners, turnHeading } from '../../../src/race/gates.ts';
import { toGame } from '../../../src/story/placements.ts';
import { courseCtx, courseNotes, deleteNode, drawTrack, gateMoved, gateWidened, gridSlotsOff, insertNode, moveNode, placeGatesAgain, setNode, widestBox } from '../../../src/editor/courseEdit.ts';
import { COURSE_TUNE } from '../../../src/race/courseTune.ts';
import { TRACK_TUNE } from '../../../src/race/trackTune.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const rules: GateRules = gateRules();
const ctx = courseCtx(() => 0);
const flat = (x: number, z: number) => ({ x, z, y: 0 });

/** A circuit drawn on flat ground: a rounded rectangle of about 1.7 km. */
function circuit(): TrackDef {
  const t = drawTrack('loop', 'Loop', [flat(0, 0), flat(400, 0), flat(500, 150), flat(400, 300), flat(0, 300), flat(-100, 150)], true, ctx);
  assert.ok(typeof t !== 'string', String(t));
  return t as TrackDef;
}

// ---- A circuit's gates: gate 0 at node 0, spacing and apexes, none too near. ----
{
  const t = circuit();
  ok(readTrack(t) !== null && typeof readTrack(t) !== 'string', 'the placed circuit reads back with no refusal');
  const sp = buildSpine(t.course!.paths[0].nodes, true);
  const g0 = t.gates[0];
  ok(g0.path === 'main' && g0.e === 0 && g0.t === 0 && Math.hypot(g0.x - 0, g0.z - 0) < 0.01, "a circuit's gate 0 stands at the main line's node 0");
  const alongs = t.gates.map((g) => alongOf(sp, g.e!, g.t!));
  let nearest = Infinity;
  for (let i = 0; i < alongs.length; i++)
    for (let j = i + 1; j < alongs.length; j++) {
      const d = Math.abs(alongs[i] - alongs[j]);
      nearest = Math.min(nearest, Math.min(d, sp.length - d));
    }
  ok(nearest >= rules.gateMin - 0.01, `no two gates nearer than gateMin along the road (nearest ${nearest.toFixed(1)} m of ${rules.gateMin})`);
  let gap = 0;
  const sorted = [...alongs].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) gap = Math.max(gap, ((i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + sp.length) - sorted[i]));
  // A spacing gate is left out where an apex's stands within gateMin of it, so a gap reaches gateEvery and gateMin at the most.
  ok(gap <= rules.gateEvery + rules.gateMin + 0.01, `a gate every gateEvery along the road, give or take an apex's (widest gap ${gap.toFixed(1)} m of ${rules.gateEvery} and ${rules.gateMin})`);
  // The gentle loop turns over hundreds of metres: no turn of it is sharp, so its gates are the spacing's alone.
  ok(turnApexes(sp, rules.gateTurnSpan, rules.gateTurn).length === 0, 'a loop of gentle curves has no turn sharper than gateTurn over gateTurnSpan');
  // A rectangle of straights with tight corners: four turns of ninety degrees inside sixty metres, a gate on each apex.
  const sharp = drawTrack(
    'box',
    'Box',
    [
      { ...flat(0, 0), c: 'straight' },
      { ...flat(500, 0), c: 'smooth' },
      { ...flat(520, 20), c: 'straight' },
      { ...flat(520, 300), c: 'smooth' },
      { ...flat(500, 320), c: 'straight' },
      { ...flat(0, 320), c: 'smooth' },
      { ...flat(-20, 300), c: 'straight' },
      { ...flat(-20, 20), c: 'smooth' },
    ],
    true,
    ctx,
  ) as TrackDef;
  const bsp = buildSpine(sharp.course!.paths[0].nodes, true);
  const balongs = sharp.gates.map((g) => alongOf(bsp, g.e!, g.t!));
  const apexes = turnApexes(bsp, rules.gateTurnSpan, rules.gateTurn);
  let apexMiss = 0;
  let byStart = 0;
  for (const a of apexes) {
    // An apex within gateMin of the start gives way to it (the start is placed first); every other has a gate of its own.
    if (Math.min(a, bsp.length - a) < rules.gateMin) {
      byStart++;
      continue;
    }
    const d = Math.min(...balongs.map((s) => Math.min(Math.abs(s - a), bsp.length - Math.abs(s - a))));
    apexMiss = Math.max(apexMiss, d);
  }
  ok(apexes.length === 4 && byStart === 1 && apexMiss < 0.01, `a gate on the apex of every turn sharper than ${rules.gateTurn}° but the one within gateMin of the start (${apexes.length} turns, the furthest apex ${apexMiss.toFixed(2)} m from its gate)`);
  // And there, where an apex and the start and the spacing all want a gate within reach of each other, none nearer than gateMin.
  let bnear = Infinity;
  for (let i = 0; i < balongs.length; i++)
    for (let j = i + 1; j < balongs.length; j++) {
      const d = Math.abs(balongs[i] - balongs[j]);
      bnear = Math.min(bnear, Math.min(d, bsp.length - d));
    }
  ok(bnear >= rules.gateMin - 0.01, `the box's gates too: no two nearer than gateMin along the road (nearest ${bnear.toFixed(1)} m)`);
  // Each on the road at gateLift, facing along it.
  let worstLift = 0;
  let worstFace = 0;
  const near = spineNear();
  const P = spinePoint();
  for (const g of t.gates) {
    spineAt(sp, g.e!, g.t!, P);
    worstLift = Math.max(worstLift, Math.abs(g.y - (P.y + rules.gateLift)), Math.hypot(g.x - P.x, g.z - P.z) - 0.01);
    nearestOn(sp, g.x, g.z, near);
    // Its heading in the game's frame against the road's there, carried into the game's frame.
    const gq = toGame(g, null, 'raw').q;
    const want = Math.atan2(-P.tx, P.tz);
    const h = turnHeading(gq);
    worstFace = Math.max(worstFace, Math.abs(Math.atan2(Math.sin(h - want), Math.cos(h - want))));
  }
  ok(worstLift < 0.02, `every gate stands on the road ${rules.gateLift} m over its surface (worst ${worstLift.toFixed(3)} m off)`);
  ok(worstFace < 1e-6, `every gate faces along the road (worst ${worstFace.toExponential(2)} rad)`);
  ok(t.gates.every((g) => g.h === TRACK_TUNE.podGateHeight && g.w === COURSE_TUNE.width), "each gate is the road's width and the pod gate's height where pods race it");
  const grid = t.grid;
  const gridAlong = alongOf(sp, grid.e!, grid.t!);
  ok(grid.path === 'main' && Math.abs(sp.length - gridAlong - rules.gridBack) < 0.5, `a circuit's grid stands ${rules.gridBack} m back along the closing edge before gate 0 (${(sp.length - gridAlong).toFixed(2)} m)`);
}

// ---- A sprint: gate 0 gridAhead along, its grid at node 0 and on the road, its last gate at its end. ----
{
  const t = drawTrack('dash', 'Dash', [flat(0, 0), flat(300, 40), flat(700, -20), flat(1000, 60)], false, ctx);
  assert.ok(typeof t !== 'string', String(t));
  const s = t as TrackDef;
  const sp = buildSpine(s.course!.paths[0].nodes, false);
  ok(s.kind === 'sprint' && s.laps === 1, 'an open course is a sprint of one lap');
  ok(Math.abs(alongOf(sp, s.gates[0].e!, s.gates[0].t!) - rules.gridAhead) < 0.01, `a sprint's gate 0 stands ${rules.gridAhead} m along from its start`);
  const last = s.gates[s.gates.length - 1];
  ok(last.e === sp.edges.length - 1 && last.t === 1, "a sprint's last gate stands at its end");
  ok(s.grid.e === 0 && s.grid.t === 0 && Math.hypot(s.grid.x, s.grid.z) < 0.01, "a sprint's grid stands at its node 0, on the road");
}

// ---- The bank: rolled about the gate's own forward axis, its heading unchanged, the driver's right up. ----
{
  for (const bank of [20, -20]) {
    const q = roadTurn(0, 1, Math.tan((bank * Math.PI) / 180));
    const flatQ = roadTurn(0, 1, 0);
    const h = turnHeading(toGame({ x: 0, y: 0, z: 0, q }, null, 'raw').q);
    const h0 = turnHeading(toGame({ x: 0, y: 0, z: 0, q: flatQ }, null, 'raw').q);
    ok(Math.abs(h - h0) < 1e-12, `a bank of ${bank}° leaves the gate's heading as it was (turnHeading)`);
    // The window's corners in the game's frame: the driver's right is (-cos h, sin h); bottom right higher than bottom left for a bank up on the right.
    const g = toGame({ x: 0, y: 10, z: 0, q }, null, 'raw');
    const baked = new Float64Array(GATE_STRIDE);
    bakeGate({ ...g, w: 20, h: 20 }, baked, 0);
    const c = new Float64Array(12);
    gateCorners(baked, 0, c, 0);
    const nose = { x: Math.sin(h), z: Math.cos(h) };
    const right = { x: -nose.z, z: nose.x };
    // Of the two bottom corners, the one to the driver's right.
    const along = (k: number) => (c[k * 3] - g.x) * right.x + (c[k * 3 + 2] - g.z) * right.z;
    const rightCorner = along(0) > along(1) ? 0 : 1;
    const leftCorner = 1 - rightCorner;
    const up = c[rightCorner * 3 + 1] - c[leftCorner * 3 + 1];
    ok(bank > 0 ? up > 1 : up < -1, `a bank of ${bank}° lifts the driver's ${bank > 0 ? 'right' : 'left'} (${up.toFixed(2)} m between the bottom corners)`);
  }
  const t = circuit();
  const banked = setNode(t, 'main', 2, { b: 15 }, ctx) as TrackDef;
  const near = banked.gates.find((g) => g.e === 2 && (g.t ?? 0) < 0.05) ?? banked.gates.find((g) => g.e === 1 && (g.t ?? 0) > 0.95);
  ok(!!near && Math.abs(near.q[1]) > 1e-3, "a gate on a banked node's road is rolled (its turn carries the roll)");
}

// ---- Width: the road's, unless its own. ----
{
  const t = circuit();
  const wide = setNode(t, 'main', 0, { w: 40 }, ctx) as TrackDef;
  ok(wide.gates[0].e === 0 && wide.gates[0].t === 0 && wide.gates[0].w === 40, "a following gate on a widened node's road takes its width (gate 0 on node 0: 40 m)");
  const own = gateWidened(wide, 1, 33) as TrackDef;
  ok(own.gates[1].ow === 1 && own.gates[1].path === 'main' && own.gates[1].w === 33, 'a following gate widened by hand keeps following and keeps its width as its own (ow)');
  const moved = moveNode(own, 'main', 1, 420, 20, ctx) as TrackDef;
  ok(moved.gates[1].w === 33 && moved.gates[1].path === 'main', 'moving the road keeps an own-width gate following at its own width');
}

// ---- An apex gate stays on its apex when an earlier edge is lengthened (an anchor is an edge and a share, never metres). ----
{
  const t = circuit();
  const sp = buildSpine(t.course!.paths[0].nodes, true);
  // The gate on edge 3's road (between node 3 and node 4), its place before.
  const i = t.gates.findIndex((g) => g.e === 3);
  assert.ok(i >= 0, 'a gate on edge 3');
  const before = t.gates[i];
  // Node 1 moved out: edges 0 and 1 lengthen; node 3's and node 4's places are untouched, and so is edge 3's shape far from it.
  const longer = moveNode(t, 'main', 1, 400, -150, ctx) as TrackDef;
  const after = longer.gates[i];
  ok(after.e === 3 && after.t === before.t && Math.hypot(after.x - before.x, after.z - before.z) < 0.05, `the gate on edge 3 stays where it stood when edges 0 and 1 lengthen (${Math.hypot(after.x - before.x, after.z - before.z).toFixed(3)} m)`);
  // Where a global arclength would have slid it: the same metres from node 0 on the lengthened road.
  const sp2 = buildSpine(longer.course!.paths[0].nodes, true);
  const s = alongOf(sp, before.e!, before.t!);
  const P = spinePoint();
  let e = 0;
  for (let k = 0; k < sp2.edges.length; k++) if (s >= sp2.start[k]) e = k;
  spineAt(sp2, e, (s - sp2.start[e]) / sp2.edges[e].len, P);
  ok(Math.hypot(P.x - before.x, P.z - before.z) > 20, `a gate placed by metres from node 0 would have slid ${Math.hypot(P.x - before.x, P.z - before.z).toFixed(1)} m`);
}

// ---- Anchors carried through an insert and a delete: every following gate keeps its place along the road. ----
{
  const t = circuit();
  const ins = insertNode(t, 'main', 2, 0.4, ctx) as TrackDef;
  ok(ins.course!.paths[0].nodes.length === t.course!.paths[0].nodes.length + 1, 'a node is put in on the road');
  // A node put in on the curve still moves the road a little near it (its neighbours' tangents change): a following gate
  // moves with its road and no further, and one on an edge the new node shapes nothing of does not move at all.
  const was = buildSpine(t.course!.paths[0].nodes, true);
  const now = buildSpine(ins.course!.paths[0].nodes, true);
  const near = spineNear();
  let road = 0;
  for (const ed of now.edges) for (let i = 0; i < ed.count; i++) road = Math.max(road, (nearestOn(was, ed.x[i], ed.z[i], near), near.d));
  let worst = 0;
  let still = 0;
  for (let k = 0; k < t.gates.length; k++) {
    const d = Math.hypot(ins.gates[k].x - t.gates[k].x, ins.gates[k].z - t.gates[k].z);
    worst = Math.max(worst, d - road);
    // Edges 0 and 4 to 5 (old numbering) lie outside what node 2's new neighbour shapes (edges -1 to 4 after it).
    if (t.gates[k].e === 0 || (t.gates[k].e ?? 0) >= 5) still = Math.max(still, d);
  }
  ok(worst < 0.5 && still === 0, `every following gate moves with its road through the insert and no further (the road moved ${road.toFixed(2)} m, a gate ${worst.toFixed(3)} m past it; the far gates ${still} m)`);
  const del = deleteNode(ins, 'main', 3, ctx) as TrackDef;
  ok(del.course!.paths[0].nodes.length === t.course!.paths[0].nodes.length, 'the node taken out again');
  let back = 0;
  for (let k = 0; k < t.gates.length; k++) back = Math.max(back, Math.hypot(del.gates[k].x - t.gates[k].x, del.gates[k].z - t.gates[k].z));
  ok(back < 0.5, `and through the delete every gate stands where it stood before the insert (worst ${back.toFixed(3)} m)`);
}

// ---- Following gates placed again; pinned ones not. ----
{
  const t = circuit();
  const pinned = gateMoved(t, 2, { x: 333, y: 5, z: 77, q: [1, 0, 0, 0] }) as TrackDef;
  ok(pinned.gates[2].path === undefined && pinned.gates[2].ow === undefined, 'a gate moved by hand drops its anchor (pinned)');
  const moved = moveNode(pinned, 'main', 2, 520, 160, ctx) as TrackDef;
  ok(moved.gates[2].x === 333 && moved.gates[2].z === 77, 'a pinned gate stays where it was put when the road moves');
  const followed = followCourse(moved, rules);
  ok(JSON.stringify(followed.gates) === JSON.stringify(moved.gates), 'following again changes nothing that already follows (idempotent)');
  const again = placeGatesAgain(moved, ctx) as TrackDef;
  const kept = again.gates.find((g) => g.x === 333 && g.z === 77);
  ok(!!kept && kept.path === undefined && again.gates.length >= moved.gates.length, 'Place gates again leaves a pinned gate where it was put (and adds where none stands)');
  ok(typeof readTrack(again) !== 'string', 'every track Place gates again makes reads back with no refusal');
}

// ---- Under a deck. ----
{
  const t = circuit();
  const deckAt = (_p: string, e: number) => (e === 0 ? 20 : -Infinity);
  const placed = placeGates(t, rules, deckAt);
  const g = placed.gates.filter((x) => x.e === 0);
  ok(g.length > 0 && g.every((x) => x.y + (x.h * 7) / 8 <= 20 + 0.02), `a gate on a road under a deck is held so its window's top stands under it (${g.map((x) => x.h).join(', ')} m tall)`);
}

// ---- A track raced only as a bike: its gates the bike gate's height. ----
{
  const bikes = drawTrack('bikes', 'Bikes', [flat(0, 0), flat(400, 0), flat(500, 150), flat(400, 300), flat(0, 300), flat(-100, 150)], true, ctx, { ...COURSE_TUNE, forPods: false, forBikes: true }) as TrackDef;
  ok(bikes.for.length === 1 && bikes.for[0] === 'speederbike' && bikes.gates.every((g) => g.h === TRACK_TUNE.bikeGateHeight), `a track raced only as a bike places gates the bike gate's height (${TRACK_TUNE.bikeGateHeight} m)`);
  ok(gateHeightFor({ for: ['speederbike'] }, rules) === rules.bikeHeight && gateHeightFor({ for: ['speederbike', 'podracer'] }, rules) === rules.podHeight, "the pod gate's height wherever pods race it, the bike gate's where bikes alone do");
}

// ---- Follow: a pinned gate anchored again to its nearest road. ----
{
  const t = circuit();
  const pinned = gateMoved(t, 2, { x: t.gates[2].x + 6, y: 40, z: t.gates[2].z - 4, q: [1, 0, 0, 0] }) as TrackDef;
  const own = gateWidened(t, 1, 33) as TrackDef;
  const f = followGate(pinned, 2, rules) as TrackDef;
  const sp = buildSpine(f.course!.paths[0].nodes, true);
  const g = f.gates[2];
  const P = spinePoint();
  spineAt(sp, g.e!, g.t!, P);
  const near = spineNear();
  nearestOn(sp, pinned.gates[2].x, pinned.gates[2].z, near);
  ok(g.path === 'main' && g.ow === undefined && Math.abs(g.e! + g.t! - (near.e + near.t)) < 1e-5 && Math.hypot(g.x - P.x, g.z - P.z) < 0.01 && Math.abs(g.y - (P.y + rules.gateLift)) < 0.01, 'Follow anchors a pinned gate on its nearest point of the road, on the road at gateLift, its own width dropped');
  const h = turnHeading(toGame(g, null, 'raw').q);
  ok(Math.abs(Math.atan2(Math.sin(h - Math.atan2(-P.tx, P.tz)), Math.cos(h - Math.atan2(-P.tx, P.tz)))) < 1e-6, 'and faces along the road there');
  const back = followGate(own, 1, rules) as TrackDef;
  ok(back.gates[1].ow === undefined && back.gates[1].w === COURSE_TUNE.width, "a gate of its own width followed again takes the road's width again");
  ok(typeof followGate({ ...t, course: undefined }, 0, rules) === 'string' && typeof followGate(t, 99, rules) === 'string', 'a track with no course, or a gate it has not got, is refused in words');
}

// ---- The notes a course's shape gives (`courseNotes`), each with a known answer. ----
{
  const ringOf = (r: number, n: number, w = COURSE_TUNE.width, at = { x: 0, z: 0 }) => Array.from({ length: n }, (_, i) => flat(at.x + r * Math.cos((i * 2 * Math.PI) / n), at.z + r * Math.sin((i * 2 * Math.PI) / n)));
  const plain = drawTrack('plain', 'Plain', [{ ...flat(0, 0), c: 'straight' }, { ...flat(600, 0) }, { ...flat(700, 150), c: 'straight' }, { ...flat(600, 300), c: 'straight' }, { ...flat(0, 300) }, { ...flat(-100, 150), c: 'straight' }], true, ctx) as TrackDef;
  const flatCtx = courseCtx(() => 0);
  ok(courseNotes(plain, flatCtx).length === 0, `a plain circuit on flat land, its grid on a straight, gives no note (${courseNotes(plain, flatCtx).join(' · ') || 'none'})`);
  // Too narrow: under the widest box raced with narrowRoom either side.
  const narrow = setNode(plain, 'main', 2, { w: 8 }, ctx) as TrackDef;
  const nn = courseNotes(narrow, flatCtx);
  ok(nn.some((s) => /node 2's road is 8 m wide, under the widest box raced \(7 m\)/.test(s)) && widestBox(plain) === 7 && widestBox({ for: ['speederbike'] }) === 1, `a node narrower than the widest box and its room is noted (${nn.join(' · ')})`);
  // Under the water: the host's level over a node.
  const wet = courseNotes(plain, { ...flatCtx, water: (x: number) => (x > 550 ? 4 : -Infinity) });
  ok(wet.filter((s) => /under the water/.test(s)).length === 3 && wet.some((s) => /node 1's road is 4\.0 m under the water/.test(s)), `nodes under the water noted with their depth (${wet.filter((s) => /water/.test(s)).join(' · ')})`);
  // A steep shoulder: a node raised 40 m over flat land, both its shoulders.
  const high = setNode(plain, 'main', 4, { y: 40 }, ctx) as TrackDef;
  const hn = courseNotes(high, flatCtx);
  ok(hn.some((s) => /node 4's right shoulder stands at \d+°/.test(s)) && hn.some((s) => /node 4's left shoulder stands at \d+°/.test(s)), `a node high over the land notes both its shoulders steep (${hn.filter((s) => /shoulder/.test(s)).join(' · ')})`);
  ok(courseNotes(high, courseCtx(() => Number.NaN)).every((s) => !/shoulder/.test(s)), 'with no land known (no block built), no shoulder is judged');
  // A turn too tight for its road: a ring of 25 m drawn 60 m wide, every edge's inside edge folding.
  const tight = drawTrack('tight', 'Tight', ringOf(25, 6), true, ctx, { ...COURSE_TUNE, width: 60 }) as TrackDef;
  const tn = courseNotes(tight, flatCtx);
  ok(tn.filter((s) => /inside edge folds over itself/.test(s)).length === 6, `every edge of a turn too tight for its road is noted folding (${tn.filter((s) => /folds/.test(s)).length})`);
  // A sprint: its grid at node 0, so a full group's rows behind the first stand before the road begins.
  const dash = drawTrack('dash2', 'Dash', [flat(0, 0), flat(300, 0), flat(600, 0)], false, ctx) as TrackDef;
  const off = gridSlotsOff(dash);
  ok(off.length === 2 && off.every((o) => o.slots.join(',') === '3,4,5,6,7,8'), `a sprint's full group: slots 3 to 8 stand off the road behind its grid, pods and bikes alike (${off.map((o) => `${o.kind}: ${o.slots.join(',')}`).join('; ')})`);
  ok(courseNotes(dash, flatCtx).some((s) => /slots 3, 4, 5, 6, 7, 8 \(raced as pods\) stand off the road behind the grid/.test(s)), 'and the notes say so');
  // A circuit whose grid stands on a long straight with room behind it: every slot on the road.
  ok(gridSlotsOff(plain).length === 0, "a circuit's grid on a straight with room behind it: a full group's slots all on the road");
}

// ---- gateAlongs: at least two on a short circuit. ----
{
  const sp = buildSpine(
    [
      { x: 0, y: 0, z: 0, w: 20, b: 0, sh: 6, c: 'smooth' },
      { x: 20, y: 0, z: 0, w: 20, b: 0, sh: 6, c: 'smooth' },
      { x: 10, y: 0, z: 15, w: 20, b: 0, sh: 6, c: 'smooth' },
    ],
    true,
  );
  ok(gateAlongs(sp, false, rules).length >= 2, 'a short circuit still has two gates');
}

console.log(`\ncourseGates: ${checks} checks passed`);
