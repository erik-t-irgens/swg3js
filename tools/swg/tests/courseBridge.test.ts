// The race drawer's second wave: Fit to land, the crossings, Fit a bridge and the carve's notes (DESIGN.md §2.11).
// The pure halves run as the editor runs them (`courseEdit.ts`): a model's walkable top (its deck between its rails, never
// a rail's top), a bridge fitted over a crossing with three's own matrix carrying it (its length laid along the upper road,
// scaled to the span, its box's middle on the crossing's middle and its top on the deck, whichever axis is its length, an
// off-centre model and the placements' backstops); the crossings of a course's own carve (a figure eight's one crossing,
// its clearance and span, a hairpin's overlapping legs told apart from one path crossing itself at an angle, a level
// crossing none); Fit to land on rolling land. Then the real Course tool over the real editing (`courseRig.ts`): the carve's
// notes (a crossing and its clearance, no row over it, a bridge's top off the deck, what stands on the road, what it keeps
// away asked of the world once a road), Fit a bridge
// handing the editor's put path the crossing nearest the aim with the span and its margins, and Fit to land as one action.
//
// Run: node tools/swg/tests/courseBridge.test.ts
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bridgeEndWords, bridgeFit, courseCrossings, courseCtx, drawTrack, fitToLand, walkableTop, walkableTops, type BridgeGeometry, type BridgeSpan } from '../../../src/editor/courseEdit.ts';
import { buildSpine, spineAt, spinePoint } from '../../../src/race/coursePath.ts';
import { COURSE_TUNE } from '../../../src/race/courseTune.ts';
import { trackFileText, type TrackDef } from '../../../src/race/trackFile.ts';
import { figureEight, hairpin } from './carveFixtures.ts';
import { courseRig, idle, landFile, land, WORLD, CENTRE } from './courseRig.ts';
import type { BridgeAsk } from '../../../src/editor/editorCourse.ts';
import type { CourseCarve } from '../../../src/swg/terrain/courseCarve.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// ---------------------------------------------------------------- 1. a model's walkable top

/** A geometry of quads (each four corners, two triangles), indexed. */
function quads(qs: number[][][]): BridgeGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const q of qs) {
    const b = pos.length / 3;
    for (const p of q) pos.push(p[0], p[1], p[2]);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g as unknown as BridgeGeometry;
}
/** A deck of length `L` along x from `x0`, its top at `top`, 6 m wide about `zc`, rails a metre over it at its sides. */
function deckModel(x0: number, L: number, top: number, zc = 0): { bounds: { min: number[]; max: number[] }; geos: BridgeGeometry[] } {
  const x1 = x0 + L;
  const zA = zc - 3;
  const zB = zc + 3;
  const deck = [
    [x0, top, zA],
    [x1, top, zA],
    [x1, top, zB],
    [x0, top, zB],
  ];
  const under = [
    [x0, top - 1, zA],
    [x0, top - 1, zB],
    [x1, top - 1, zB],
    [x1, top - 1, zA],
  ];
  // Rails: a strip 0.2 m wide along each side, a metre over the deck.
  const rail = (z0: number, z1: number) => [
    [x0, top + 1, z0],
    [x1, top + 1, z0],
    [x1, top + 1, z1],
    [x0, top + 1, z1],
  ];
  // A side face (upright: never a top).
  const side = [
    [x0, top - 1, zA],
    [x1, top - 1, zA],
    [x1, top + 1, zA],
    [x0, top + 1, zA],
  ];
  return { bounds: { min: [x0, top - 1, zA], max: [x1, top + 1, zB] }, geos: [quads([deck, under, side]), quads([rail(zA, zA + 0.2), rail(zB - 0.2, zB)])] };
}
{
  const m = deckModel(-10, 20, 1);
  ok(Math.abs(walkableTop(m.bounds, m.geos) - 1) < 1e-9, "a model's walkable top is its deck between its rails, never a rail's top or its box's");
  const arch = { bounds: { min: [-10, 0, -3], max: [10, 4, 3] }, geos: [quads([[[-10, 4, -3], [-2, 4, -3], [-2, 4, 3], [-10, 4, 3]]])] };
  ok(walkableTop(arch.bounds, arch.geos) === 4, "and a model with no top over its middle answers its box's top");
  // A crossbeam over mid-span (a gantry, a sign): the middle's ray meets the beam, the end rays the deck, and the median of
  // the three is the deck (§2.11: rays at the span's middle and ends), where the middle's alone took the beam for the deck.
  const beam = deckModel(-10, 20, 1);
  const beamGeos = [...beam.geos, quads([[[-1, 4, -3], [1, 4, -3], [1, 4, 3], [-1, 4, 3]]])];
  const beamBounds = { min: beam.bounds.min, max: [beam.bounds.max[0], 4, beam.bounds.max[2]] };
  const tops = walkableTops(beamBounds, beamGeos);
  ok(tops.mid === 4 && tops.a === 1 && tops.b === 1 && walkableTop(beamBounds, beamGeos) === 1, `a crossbeam over the middle is never the deck: the middle's ray meets it (${tops.mid}), the ends' the deck (${tops.a}, ${tops.b}), the walkable top the deck`);
}

// ---------------------------------------------------------------- 2. a bridge fitted, carried by three's own matrix

/** The fit carried by three: the model's points in the game's frame. */
function carried(fit: ReturnType<typeof bridgeFit>): (x: number, y: number, z: number) => THREE.Vector3 {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(fit.at.x, fit.at.y, fit.at.z), new THREE.Quaternion(fit.q[0], fit.q[1], fit.q[2], fit.q[3]), new THREE.Vector3(...fit.scale));
  return (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(m);
}
for (const [label, model, axis] of [
  ['long in x, off its origin', deckModel(2, 20, 1.5, 1), 'x'],
  ['long in z', (() => {
    const b = deckModel(-15, 30, 1);
    // The same deck turned a quarter (x to z): its points swapped.
    const turn = (g: BridgeGeometry): BridgeGeometry => {
      const p = g.getAttribute('position')!;
      const pos: number[] = [];
      for (let i = 0; i < p.count; i++) pos.push(p.getZ(i), p.getY(i), p.getX(i));
      const out = new THREE.BufferGeometry();
      out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      out.setIndex(Array.from({ length: g.index!.count }, (_, i) => g.index!.getX(i)));
      return out as unknown as BridgeGeometry;
    };
    return { bounds: { min: [b.bounds.min[2], b.bounds.min[1], b.bounds.min[0]], max: [b.bounds.max[2], b.bounds.max[1], b.bounds.max[0]] }, geos: b.geos.map(turn) };
  })(), 'z'],
] as const) {
  for (const way of [
    [0.6, 0.8],
    [-1, 0],
    [0.28, -0.96],
  ]) {
    const ask: BridgeSpan = { x: 100, z: -50, deck: 8, ux: way[0], uz: way[1], span: 34 };
    const fit = bridgeFit(model.bounds, model.geos, ask, CENTRE);
    const at = carried(fit);
    const b = model.bounds;
    const mid = { x: (b.min[0] + b.max[0]) / 2, z: (b.min[2] + b.max[2]) / 2 };
    const gmid = at(mid.x, fit.top, mid.z);
    const want = { x: CENTRE.x - ask.x, z: ask.z - CENTRE.z };
    // The length axis carried: from one end of the box's long side to the other.
    const a0 = axis === 'x' ? at(b.min[0], fit.top, mid.z) : at(mid.x, fit.top, b.min[2]);
    const a1 = axis === 'x' ? at(b.max[0], fit.top, mid.z) : at(mid.x, fit.top, b.max[2]);
    const dir = a1.clone().sub(a0);
    const along = Math.abs((dir.x * -ask.ux + dir.z * ask.uz) / dir.length());
    ok(fit.axis === axis && Math.abs(gmid.x - want.x) < 1e-9 && Math.abs(gmid.z - want.z) < 1e-9 && Math.abs(gmid.y - ask.deck) < 1e-9, `a model ${label}, the road's way (${way}): its box's middle on the crossing's middle in the game's frame and its walkable top on the deck`);
    ok(along > 1 - 1e-9 && Math.abs(dir.length() - ask.span) < 0.001 * fit.length + 1e-9, `  and its length (${fit.length} m) laid along the upper road (the raw way mirrored into the game's) and scaled to the span (${dir.length().toFixed(3)} m of ${ask.span})`);
  }
}
{
  const m = deckModel(0, 1, 0);
  const huge = bridgeFit(m.bounds, m.geos, { x: 0, z: 0, deck: 0, ux: 1, uz: 0, span: 1e6 }, null);
  const tiny = bridgeFit(m.bounds, m.geos, { x: 0, z: 0, deck: 0, ux: 1, uz: 0, span: 0 }, null);
  ok(huge.s === 1000 && tiny.s === 0.001, "the scale is held to the placements' backstops (1,000 and a thousandth)");
}
{
  // A flat bridge over a road that climbs across the gap stands off it at its ends, which the fit measures and says.
  const m = deckModel(-10, 20, 1);
  const flat = bridgeFit(m.bounds, m.geos, { x: 0, z: 0, deck: 8, ux: 1, uz: 0, span: 24, deckA: 8, deckB: 8 }, null);
  const climb = bridgeFit(m.bounds, m.geos, { x: 0, z: 0, deck: 8, ux: 1, uz: 0, span: 24, deckA: 7.2, deckB: 8.8 }, null);
  ok(Math.abs(flat.offA) < 1e-9 && Math.abs(flat.offB) < 1e-9 && bridgeEndWords(flat) === '', "over a flat road the bridge's ends stand on it, and nothing is said");
  ok(Math.abs(climb.offA - 0.8) < 1e-9 && Math.abs(climb.offB + 0.8) < 1e-9 && /stands -?0\.80 m off the upper road at one end/.test(bridgeEndWords(climb)), `over a road climbing 1.6 m across the gap its ends stand ${climb.offA.toFixed(2)} and ${climb.offB.toFixed(2)} m off it, which is said (${bridgeEndWords(climb).slice(2, 60)}...)`);
  const none = bridgeFit(m.bounds, m.geos, { x: 0, z: 0, deck: 8, ux: 1, uz: 0, span: 24 }, null);
  ok(Number.isNaN(none.offA) && Number.isNaN(none.offB) && bridgeEndWords(none) === '', 'and with no road handed over at the ends, nothing is measured or said');
}

// ---------------------------------------------------------------- 3. the crossings of a course's own carve

{
  const e8 = figureEight('eight', 8) as unknown as TrackDef;
  const cs = courseCrossings(e8);
  ok(cs.length === 1 && !cs[0].hairpin && cs[0].upper === 'main' && cs[0].lower === 'main', `a figure eight (one path crossing itself at an angle) has one crossing, not a hairpin (${cs.length})`);
  const c = cs[0];
  ok(Math.hypot(c.x, c.z) < 3 && Math.abs(c.clearance - 8) < 0.05 && Math.abs(c.deck - 8) < 0.05, `  at its middle, 8 m over the lower road (${c.clearance.toFixed(2)} m of clearance, near (${c.x.toFixed(1)}, ${c.z.toFixed(1)}))`);
  ok(Math.abs(Math.abs(c.ux) - Math.SQRT1_2) < 0.01 && Math.abs(Math.abs(c.uz) - Math.SQRT1_2) < 0.01 && c.span >= 14 && c.span <= 20, `  its way the upper road's diagonal, its gap's span the lower road's slot (${c.span.toFixed(1)} m: 16 m square on)`);
  // Each end of the gap read a pole inside it, on the upper road: within the gap's half span of its middle, the road there.
  const halfA = Math.hypot(c.xA - c.x, c.zA - c.z);
  const halfB = Math.hypot(c.xB - c.x, c.zB - c.z);
  ok(halfA > 1 && halfA < c.span / 2 && halfB > 1 && halfB < c.span / 2 && Math.abs(c.deckA - 8) < 0.05 && Math.abs(c.deckB - 8) < 0.05, `  its gap's ends read inside it on the upper road (${halfA.toFixed(1)} and ${halfB.toFixed(1)} m from the middle), the road there at the deck`);
  const level = courseCrossings(figureEight('flat', 0) as unknown as TrackDef);
  ok(level.length === 0, 'a level crossing is no crossing (no slot under it)');
  const pin = courseCrossings(hairpin('pin', 5, 6) as unknown as TrackDef);
  ok(pin.length > 0 && pin.every((p) => p.hairpin), `a hairpin whose legs overlap at different heights is told as one (${pin.length} runs)`);
}

// ---------------------------------------------------------------- 4. Fit to land

{
  const rolling = (x: number, z: number) => 5 + 6 * Math.sin(x / 40) + 0.01 * z;
  const ctx = courseCtx(rolling);
  const t = drawTrack('run', 'Run', [{ x: -200, z: 0, y: 0 }, { x: 200, z: 0, y: 0 }], false, ctx) as TrackDef;
  const pathId = t.course!.paths[0].id;
  ok(typeof fitToLand(t, 'nothing', ctx) === 'string', 'Fit to land refuses a path that is not there, in words');
  const fit = fitToLand(t, pathId, ctx);
  ok(typeof fit !== 'string', 'Fit to land fits a sprint over rolling land');
  const ft = fit as TrackDef;
  const nodes = ft.course!.paths[0].nodes;
  ok(nodes.length > 2 && nodes.every((n) => Math.abs(n.y - rolling(n.x, n.z)) < 0.01), `  every node on the land (${nodes.length} nodes, put in where the land left the line)`);
  const sp = buildSpine(nodes, false);
  const P = spinePoint();
  let worst = 0;
  for (let e = 0; e < sp.edges.length; e++) {
    const ed = sp.edges[e];
    for (let s = COURSE_TUNE.fitStep; s < ed.len * 0.98; s += COURSE_TUNE.fitStep) {
      if (s < ed.len * 0.02) continue;
      if (!spineAt(sp, e, s / ed.len, P)) continue;
      worst = Math.max(worst, Math.abs(rolling(P.x, P.z) - P.y));
    }
  }
  ok(worst <= COURSE_TUNE.fitTol + 0.05, `  and the road nowhere leaves the land by more than the tolerance at the fit's own step (${worst.toFixed(3)} m against ${COURSE_TUNE.fitTol})`);
}

// ---------------------------------------------------------------- 5. the tool: the notes, Fit a bridge, Fit to land

{
  const drawn = drawTrack('eight', 'Eight', [{ x: -180, z: 0, y: 3 }, { x: -90, z: 90, y: 8 }, { x: 90, z: -90, y: 8 }, { x: 180, z: 0, y: 3 }, { x: 90, z: 90, y: 0 }, { x: -90, z: -90, y: 0 }], true, courseCtx(() => 0)) as TrackDef;
  // Its grass kept (`grass: 'keep'`), so the notes' count of what stands on the road is its own and never the grass's.
  const e8: TrackDef = { ...drawn, course: { ...drawn.course!, grass: 'keep' } };
  const r = courseRig({ tracks: trackFileText(WORLD, 'raw', [{ ...e8, at: 1_700_000_000_000 }]) });
  landFile(r);
  await r.c.arm();
  r.c.pick('eight');
  const t = r.tracks()[0];
  const cross = courseCrossings(t);
  ok(cross.length === 1 && !cross[0].hairpin, 'the drawn figure eight has its one crossing');
  const host = r.host as unknown as { solidTopAt?: (x: number, z: number, from: number, to: number) => number; feetIn?: (x0: number, z0: number, x1: number, z1: number, on: (x: number, z: number, r: number) => boolean) => { game: number; ours: number; players: number }; fitBridge?: (a: BridgeAsk) => Promise<{ ok: boolean; words: string }> };
  let notes = r.c.notesOf(t);
  ok(notes.some((n) => /crosses over main .* of clearance/.test(n)) && notes.some((n) => /no solid row stands over the crossing/.test(n)), `the notes say the crossing and its clearance, and that nothing stands over it (${notes.filter((n) => /cross/.test(n)).join(' | ')})`);
  host.solidTopAt = () => cross[0].deck + 0.2;
  notes = r.c.notesOf(t);
  ok(!notes.some((n) => /no solid row|off the deck/.test(n)), "a bridge whose top is within the lip of the deck is said nothing of");
  host.solidTopAt = () => cross[0].deck + COURSE_TUNE.deckLip + 0.4;
  notes = r.c.notesOf(t);
  ok(notes.some((n) => /stands 0\.9\d m off the deck/.test(n)), 'a bridge whose top stands off the deck past the lip is said so');
  // What stands on the road: a foot at the crossing, one on the shoulder beside node 0 (within the track's `clear`), one far off.
  const n0 = t.course!.paths[0].nodes[0];
  ok(t.course!.grass === 'keep' && 1.5 < t.clear, 'the drawn course keeps its grass, and its shoulder foot stands within its clear');
  host.feetIn = (_x0, _z0, _x1, _z1, on) => ({ game: (on(cross[0].x, cross[0].z, 0.5) ? 1 : 0) + (on(400, 400, 1) ? 1 : 0), ours: on(n0.x - (n0.w / 2 + 1), n0.z, 0.4) ? 1 : 0, players: 0 });
  notes = r.c.notesOf(t);
  ok(notes.some((n) => n === 'the road meets 1 of the game\'s objects (they stand where they stood: the carve keeps off nothing placed)'), `what stands on the road is counted by its own (the road alone, never the shoulder): ${notes.find((n) => /road meets/.test(n)) ?? '(none)'}`);
  // What the road keeps away of the people and the wild sites (§2.7: no-spawn, never no-enter), asked of the world with a
  // store of this track alone.
  const keptAsked: string[] = [];
  (host as { keptAway?: (s: CourseCarve) => { posts: number; sites: number } }).keptAway = (s) => {
    keptAsked.push(s.outlines().map((o) => o.id).join(','));
    return { posts: 3, sites: 1 };
  };
  notes = r.c.notesOf(t);
  ok(notes.includes("the road keeps 3 of the people's posts and 1 wild site away (no-spawn, never no-enter)") && keptAsked.length === 1 && /course:eight:/.test(keptAsked[0]), `what the road keeps away is asked of the world over the track's own outlines and said (${notes.find((n) => /keeps/.test(n)) ?? '(none)'})`);
  // Kept by the road it was asked of (the world's answer is a laying of its wild sites, 30 to 40 ms on the converted worlds,
  // and the notes are worked out at every landing and pick, twice for one of the tool's own writes): the same road again, a
  // copy of it, its gates moved or its name changed ask nothing; its road moved, its `clear` changed or another world asks again.
  r.c.notesOf(t);
  r.c.notesOf({ ...t, name: 'Renamed', gates: t.gates.map((g) => ({ ...g, w: g.w + 1 })) });
  const sameRoad = r.c.notesOf(JSON.parse(JSON.stringify(t)) as TrackDef);
  const unmoved = keptAsked.length;
  const moved = JSON.parse(JSON.stringify(t)) as TrackDef;
  moved.course!.paths[0].nodes[0].x += 10;
  r.c.notesOf(moved);
  const afterMove = keptAsked.length;
  r.c.notesOf({ ...t, clear: t.clear + 3 });
  const afterClear = keptAsked.length;
  r.c.notesOf(t);
  r.c.notesOf(t);
  const back = keptAsked.length;
  const markHost = r.host as unknown as { worldMark: () => number };
  const mark = markHost.worldMark;
  markHost.worldMark = () => mark() + 1000;
  r.c.notesOf(t);
  markHost.worldMark = mark;
  ok(unmoved === 1 && sameRoad.includes("the road keeps 3 of the people's posts and 1 wild site away (no-spawn, never no-enter)") && afterMove === 2 && afterClear === 3 && back === 4 && keptAsked.length === 5, `asked once a road and world: ${unmoved} for the same road, a copy, its gates and name changed; ${afterMove} once moved, ${afterClear} its clear changed, ${back} back on the first road asked twice, ${keptAsked.length} on another world`);
  (host as { keptAway?: unknown }).keptAway = () => ({ posts: 0, sites: 0 });
  ok(!r.c.notesOf(t).some((n) => /keeps .* away/.test(n)), 'and nothing kept away is said nothing of');
  // Fit a bridge: the crossing nearest the aim handed to the editor's put path, its span with the margins.
  let asked: BridgeAsk | null = null;
  host.fitBridge = async (a) => {
    asked = a;
    return { ok: true, words: 'a bridge stood' };
  };
  const said = await r.c.fitBridge('eight');
  const a = asked as BridgeAsk | null;
  ok(!!a && /a bridge stood/.test(said) && Math.abs(a.span - (cross[0].span + 2 * t.course!.margin + 4)) < 1e-9 && Math.abs(a.deck - cross[0].deck) < 1e-9 && Math.hypot(a.x - cross[0].x, a.z - cross[0].z) < 1e-9, `Fit a bridge hands the crossing over, its span the gap's and its margins (${a?.span.toFixed(1)} m)`);
  r.c.disarm();
}
{
  // A crossing on an upper road that climbs across the gap (its nodes at -8 and 24 m, the deck 8 m over the crossing): a flat
  // bridge on the deck at the middle stands off the road at its ends (§2.11's "at either abutment"), which the notes say.
  const drawn = drawTrack('climb', 'Climb', [{ x: -180, z: 0, y: 3 }, { x: -90, z: 90, y: -8 }, { x: 90, z: -90, y: 24 }, { x: 180, z: 0, y: 3 }, { x: 90, z: 90, y: 0 }, { x: -90, z: -90, y: 0 }], true, courseCtx(() => 0)) as TrackDef;
  const r = courseRig({ tracks: trackFileText(WORLD, 'raw', [{ ...drawn, at: 1_700_000_000_000 }]) });
  landFile(r);
  await r.c.arm();
  r.c.pick('climb');
  const t = r.tracks()[0];
  const cross = courseCrossings(t);
  const c = cross[0];
  ok(cross.length === 1 && c.deckA < c.deck - COURSE_TUNE.deckLip && c.deckB > c.deck + COURSE_TUNE.deckLip, `a climbing upper road's gap ends stand ${(c.deckA - c.deck).toFixed(2)} and ${(c.deckB - c.deck).toFixed(2)} m off its middle: the precondition`);
  const host = r.host as unknown as { solidTopAt?: (x: number, z: number, from: number, to: number) => number };
  host.solidTopAt = () => c.deck;
  const notes = r.c.notesOf(t);
  ok(notes.filter((n) => /off the deck at its (first|far) end/.test(n)).length === 2 && !notes.some((n) => /no solid row|stands -?\d+\.\d+ m off the deck \(more/.test(n)), `a flat bridge on the deck at the middle is said to stand off the road at both its ends (${notes.filter((n) => /end/.test(n)).join(' | ')})`);
  host.solidTopAt = (x, z) => (Math.hypot(x - c.xA, z - c.zA) < 0.5 ? c.deckA : Math.hypot(x - c.xB, z - c.zB) < 0.5 ? c.deckB : c.deck);
  ok(!r.c.notesOf(t).some((n) => /off the deck/.test(n)), 'and one that follows the road at its ends is said nothing of');
  r.c.disarm();
}
{
  const pin = hairpin('pin', 5, 6) as unknown as TrackDef;
  const t = drawTrack('pin', 'Pin', pin.course!.paths[0].nodes.map((n) => ({ x: n.x, z: n.z, y: n.y })), false, courseCtx(() => 0)) as TrackDef;
  const r = courseRig({ tracks: trackFileText(WORLD, 'raw', [{ ...t, at: 1_700_000_000_000 }]) });
  landFile(r);
  await r.c.arm();
  (r.host as unknown as { fitBridge: () => Promise<{ ok: boolean; words: string }> }).fitBridge = async () => ({ ok: true, words: 'no' });
  const said = await r.c.fitBridge('pin');
  ok(/crosses itself nowhere/.test(said), `a course whose only overlap is a hairpin's is offered no bridge (${said})`);
  r.c.disarm();
}
{
  const t = drawTrack('run', 'Run', [{ x: 1000, z: -400, y: 0 }, { x: 1200, z: -400, y: 0 }], false, courseCtx(land)) as TrackDef;
  const r = courseRig({ tracks: trackFileText(WORLD, 'raw', [{ ...t, at: 1_700_000_000_000 }]) });
  landFile(r);
  await r.c.arm();
  r.c.pick('run');
  const said = await r.c.fitLand('run');
  await idle(r);
  const nodes = r.tracks()[0].course!.paths[0].nodes;
  ok(r.c.last.ok && r.h.e.history.actions.length === 1 && nodes.every((n) => Math.abs(n.y - land(n.x, n.z)) < 0.01), `Fit to land is one action, every node on the land (${said})`);
  r.c.disarm();
}

console.log(`\ncourseBridge: ${checks} checks passed`);
