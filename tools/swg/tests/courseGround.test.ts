// The race drawer's wave 3b, its pure half (`A:\swg3js\racedrawer\DESIGN.md` §5b): a track with none of the new fields reads,
// hashes, writes and carves as at 9626246 (that commit's `trackFile.ts`, `coursePath.ts`, `raceWalls.ts` and `courseCarve.ts`
// loaded out of git beside today's, and held to hashes recorded from them where git cannot answer); a node that follows the
// ground (`cut: false`) carves nothing there and eases by the spine's smooth step; the track's own ground (shapes and brush
// cells) laid in the road's own frame, moving with its road, laid only where its pass's carve wins, and taken with a stretch
// deleted; the start and the finish; gates of any size; and the carve allocating nothing with ground and following nodes.
//
// Run: node tools/swg/tests/courseGround.test.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { getHeapSpaceStatistics } from 'node:v8';
import { loadOldMany, oldTexts } from './oldModules.ts';
import { readTrack, readTrackFile, trackFileText, trackHash, courseSpines, TRACK_LIMITS, type TrackDef } from '../../../src/race/trackFile.ts';
import { CourseCarve, CourseGrid, carveAsk, deckAsk } from '../../../src/swg/terrain/courseCarve.ts';
import { brushChanged, courseCtx, courseNotes, cutRange, deleteNode, deletePath, addShortcut, drawTrack, insertNode, finishHere, groundTakenWords, moveNode, placeGatesAgain, setNode, shapeAdded, shapeAt, shapeRemoved, shapeSet, startHere } from '../../../src/editor/courseEdit.ts';
import { BRUSH_ALONG, CELLS_MOST, brushCells, brushNamed, cellBytes, keepBrushCells, primeBrush, shapeHeight, KIND_CODE, type BrushChunk } from '../../../src/race/courseGround.ts';
import { alongOf, gateOnSpine, locateAlong } from '../../../src/race/courseGates.ts';
import { spineAt, spinePoint } from '../../../src/race/coursePath.ts';
import { TrackStroke } from '../../../src/editor/trackBrush.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (w: string): void => console.log(`note ${w}`);

const PRE = '9626246';
/** The raw ground: a gentle plane. */
const land = (x: number, z: number): number => 5 + 0.002 * x - 0.001 * z;
const ctx = courseCtx(land);
const made = (e: TrackDef | string): TrackDef => {
  if (typeof e === 'string') assert.fail(e);
  return e;
};
const hash = (xs: number[]): string => createHash('sha1').update(new Uint8Array(new Float64Array(xs).buffer)).digest('hex').slice(0, 16);
const inflate = async (b64: string) => new Uint8Array(inflateRawSync(Buffer.from(b64, 'base64')));
const deflate = (bytes: Uint8Array) => deflateRawSync(Buffer.from(bytes)).toString('base64');

// ---------------------------------------------------------------- fixtures (no new fields)
const ring: { x: number; z: number; y: number }[] = [];
for (let i = 0; i < 12; i++) {
  const a = (i / 12) * Math.PI * 2;
  ring.push({ x: Math.cos(a) * 300, z: Math.sin(a) * 300, y: 8 + 4 * Math.sin(a * 2) });
}
const loop = made(drawTrack('loop', 'TEST loop', ring, true, ctx));
const sprint = made(drawTrack('lane', 'TEST lane', [0, 100, 200, 300, 400].map((x) => ({ x, z: 0, y: 10 })), false, ctx));
// A crossing: a road along z rising to 20 m over the lane at x 200.
const over = made(drawTrack('over', 'TEST over', [-300, -100, 100, 300].map((z, i) => ({ x: 200, z, y: i === 1 || i === 2 ? 20 : 10 })), false, ctx));
const cutPts = [{ x: 300, z: 0, y: 8 }, { x: 0, z: 300, y: 10 }, { x: -300, z: 0, y: 8 }];
const withShortcut = made(addShortcut(loop, cutPts, 'main', 'main', ctx));
const plain = [withShortcut, sprint, over];
if (process.argv.includes('measure')) {
  await measureLay();
  process.exit(0);
}

/** A store's answers over a field of points: the carve over the plane, the sample, the deck, the passes, and a block laid. */
function answers(Store: typeof CourseCarve, tracks: readonly TrackDef[]): number[] {
  const s = new Store();
  s.set(tracks as never);
  const out: number[] = [];
  const sample = { T: 0, W: 0, D: 0 };
  const deck = deckAsk();
  for (let z = -340; z <= 340; z += 6) {
    for (let x = -340; x <= 440; x += 6) {
      const raw = land(x, z);
      out.push(s.carveAt(raw, x, z));
      s.sampleAt(x, z, sample as never);
      out.push(sample.T, sample.W);
      deck.x = x;
      deck.z = z;
      deck.edge = -1;
      s.deckOf(deck);
      out.push(Number.isFinite(deck.out) ? deck.out : -1);
      out.push(s.passesAt(x, z));
    }
  }
  const a = carveAsk();
  const n = 33;
  const raw = new Float32Array(n * n);
  const o = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) raw[j * n + i] = land(160 + i * 2, -32 + j * 2);
  a.raw = raw;
  a.out = o;
  a.x0 = 160;
  a.dx = 2;
  a.z0 = -32;
  a.dz = 2;
  a.nx = n;
  a.nz = n;
  a.widen = 0;
  s.layIn(a);
  for (let k = 0; k < o.length; k++) out.push(o[k]);
  return out;
}

// ---------------------------------------------------------------- 1. day one against 9626246
// Recorded from 9626246's own modules (the plain fixtures' carve, and the committed track files' text and hashes).
const RECORDED = { carve: 'b0d89e8c7ffb655d', files: '23a0549b26bb9806,64e2f032ac23208c', plain: '23a0549b26bb9806' };
{
  const nowCarve = hash(answers(CourseCarve, plain));
  const committed = oldTexts(['public/tracks/tatooine.json'], PRE);
  const mods = await loadOldMany(['src/swg/terrain/courseCarve.ts', 'src/race/coursePath.ts', 'src/race/trackFile.ts', 'src/race/raceWalls.ts'], ['src/swg/terrain/courseCarve.ts', 'src/race/trackFile.ts'], PRE);
  const fileTrace = (rd: typeof readTrackFile, text: typeof trackFileText, h: typeof trackHash, src: string): string => {
    const r = rd(src, 'tatooine', 'ground');
    return createHash('sha1').update(JSON.stringify([r, text('tatooine', 'raw', r.tracks), r.tracks.map(h)])).digest('hex').slice(0, 16);
  };
  const plainText = trackFileText('tatooine', 'raw', plain);
  if (mods) {
    const [oldCarve, oldFile] = mods as [{ CourseCarve: typeof CourseCarve }, { readTrackFile: typeof readTrackFile; trackFileText: typeof trackFileText; trackHash: typeof trackHash }];
    const was = answers(oldCarve.CourseCarve, plain);
    const now = answers(CourseCarve, plain);
    let same = was.length === now.length;
    for (let i = 0; same && i < was.length; i++) if (!Object.is(was[i], now[i])) same = false;
    ok(same, `a course with every node cutting and no ground of its own carves as ${PRE}'s store to the bit (${now.length} answers: carve, sample, deck, passes, a block laid)`);
    const srcs = [plainText, ...(committed ? [committed.get('public/tracks/tatooine.json')!] : [])];
    const oldTrace = srcs.map((s) => fileTrace(oldFile.readTrackFile, oldFile.trackFileText, oldFile.trackHash, s)).join(',');
    const newTrace = srcs.map((s) => fileTrace(readTrackFile, trackFileText, trackHash, s)).join(',');
    ok(oldTrace === newTrace, `the plain fixtures and ${PRE}'s committed tatooine.json read, write and hash as ${PRE}'s reader (${newTrace})`);
    if (RECORDED.carve !== 'RECORD_CARVE') ok(hash(was) === RECORDED.carve && oldTrace === RECORDED.files, `${PRE}'s own traces are the hashes recorded from it`);
    else note(`record: carve ${hash(was)}, files ${oldTrace}`);
  } else note(`git cannot hand ${PRE} over: held to the hashes recorded from it`);
  if (RECORDED.carve !== 'RECORD_CARVE') {
    ok(nowCarve === RECORDED.carve, `the plain fixtures carve to the trace recorded from ${PRE} (${nowCarve})`);
    // The fixtures' own file trace, held whether git answers or not (the review round): the committed file's needs git.
    ok(fileTrace(readTrackFile, trackFileText, trackHash, plainText) === RECORDED.plain && RECORDED.files.split(',')[0] === RECORDED.plain, `the plain fixtures read, write and hash to the trace recorded from ${PRE}'s reader (${RECORDED.plain}), git or none`);
    if (committed) ok([plainText, committed.get('public/tracks/tatooine.json')!].map((s) => fileTrace(readTrackFile, trackFileText, trackHash, s)).join(',') === RECORDED.files, `and read, write and hash to it`);
  }
  // Every track of the owner's own file without the new fields reads as the plain fixtures do; one carrying them is named apart.
  const own = readTrackFile(trackFileText('tatooine', 'raw', plain), 'tatooine', 'ground');
  ok(own.tracks.every((t) => !t.course?.ground && !t.course?.brush && !t.course?.paths.some((p) => p.nodes.some((n) => n.cut === false))), 'a course with none of the new fields carries none after a read');
}

// ---------------------------------------------------------------- 2. a node that follows the ground
{
  const t = made(setNode(sprint, undefined, 2, { cut: false }, ctx));
  const n2 = t.course!.paths[0].nodes[2];
  ok(n2.cut === false && n2.y === Math.round(land(n2.x, n2.z) * 100) / 100, `a node set to follow takes the land's height under it (${n2.y} m)`);
  const text = trackFileText('w', 'raw', [t]);
  ok(/"c": "smooth", "cut": false/.test(text) && !/"cut": true/.test(text) && readTrackFile(text, 'w', 'ground').tracks[0].course!.paths[0].nodes[2].cut === false, 'the file writes `cut` only where it is false, and reads it back');
  const s = new CourseCarve();
  s.set([t]);
  const raw2 = land(200, 0);
  ok(Object.is(s.carveAt(raw2, 200, 0), raw2), 'at the following node the carve changes nothing: the raw ground to the bit');
  const T1 = t.course!.paths[0].nodes[1].y;
  ok(s.carveAt(land(100, 0), 100, 0) === T1, `at a cutting node the road's surface (${T1} m)`);
  // Between them the carve's weight eases by the spine's smooth step: a share of the cut that falls monotonically, with no step.
  let worst = 0;
  let mono = true;
  let prev = 1;
  let first = -1;
  let sumOk = true;
  for (let x = 100; x <= 200; x += 1) {
    const r = land(x, 0);
    const why = s.explain(x, 0);
    const p = why.passes[0] as { cuts: number; surface: number };
    const k = p.cuts;
    if (first < 0) first = k;
    if (k > prev + 1e-9) mono = false;
    worst = Math.max(worst, prev - k);
    prev = k;
    // The ground there: raw eased toward the road's surface by how much it cuts (the explain's rounded surface aside).
    if (Math.abs(s.carveAt(r, x, 0) - (r + (why.T - r) * why.W)) > 1e-9) sumOk = false;
  }
  ok(first === 1 && mono && worst < 0.02 && prev === 0 && sumOk, `between a cutting node and a following one the cut eases from 1 to nought by the smooth step (the largest fall a metre ${worst.toFixed(4)}, never a step)`);
  const back = made(cutRange(t, undefined, 1, 3, true, ctx));
  ok(back.course!.paths[0].nodes.every((n) => n.cut === undefined), 'Cut the ground over a range takes every node of it back to cutting');
  const fol = made(cutRange(sprint, undefined, 1, 3, false, ctx));
  ok(fol.course!.paths[0].nodes.filter((n) => n.cut === false).length === 3, 'Follow the land over nodes 1 to 3 makes three nodes follow, one action');
  const mv = made(moveNode(t, undefined, 2, 200, 40, ctx));
  ok(mv.course!.paths[0].nodes[2].y === Math.round(land(200, 40) * 100) / 100, 'a following node moved takes the land where it is put');
  // A course of following nodes alone carves nothing at all.
  const all = made(cutRange(sprint, undefined, 0, 4, false, ctx));
  const sa = new CourseCarve();
  sa.set([all]);
  let none = true;
  for (let x = -20; x <= 420; x += 3) for (let z = -40; z <= 40; z += 3) if (!Object.is(sa.carveAt(land(x, z), x, z), land(x, z))) none = false;
  ok(none, 'a road that follows the ground everywhere carves nothing anywhere');
}

// ---------------------------------------------------------------- 3. the track's own ground, in the road's own frame
const holeOn = (t: TrackDef, s: Parameters<typeof shapeAdded>[1]) => made(shapeAdded(t, s));
{
  const base = { kind: 'hole' as const, path: 'main', e: 1, t: 0.5, off: 0, turn: 0, l: 12, w: 10, h: 2, soft: 0 };
  const t = holeOn(sprint, base);
  const s = new CourseCarve();
  s.set([t]);
  const T = 10;
  ok(s.carveAt(land(150, 0), 150, 0) === T - 2 && s.carveAt(land(155, -4), 155, -4) === T - 2, 'a hole 2 m deep lowers the road inside it (its middle and 5 m along, 4 m across)');
  ok(s.carveAt(land(157, 0), 157, 0) === T && s.carveAt(land(150, -6), 150, -6) === T, 'and nothing past its own length or width');
  // Its height is `shapeHeight`, the one rule, wherever it is asked on the road.
  let worst = 0;
  const ramp = holeOn(sprint, { ...base, kind: 'ramp', h: 3, soft: 1.5, back: 4, turn: 25 });
  const sr = new CourseCarve();
  sr.set([ramp]);
  const th = (25 * Math.PI) / 180;
  for (let a = -10; a <= 10; a += 0.7) {
    for (let o = -8; o <= 8; o += 0.9) {
      const x = 150 + a;
      const z = -o;
      const u = a * Math.cos(th) + o * Math.sin(th);
      const v = -a * Math.sin(th) + o * Math.cos(th);
      const want = T + shapeHeight(KIND_CODE.ramp, u, v, 6, 5, 3, 1.5, 4);
      worst = Math.max(worst, Math.abs(sr.carveAt(land(x, z), x, z) - want));
    }
  }
  ok(worst < 1e-9, `a turned ramp with a far slope is laid by the shape's own rule in the road's frame (worst ${worst.toExponential(1)} m)`);
  ok(shapeHeight(KIND_CODE.ramp, 5.99, 0, 6, 5, 3, 0, 0) > 2.99 && shapeHeight(KIND_CODE.ramp, 6.01, 0, 6, 5, 3, 0, 0) === 0 && Math.abs(shapeHeight(KIND_CODE.ramp, 8, 0, 6, 5, 3, 0, 4) - 1.5) < 1e-12, "a ramp rises to its lip and drops (no back) or slopes back over `back`");
  ok(shapeHeight(KIND_CODE.trench, 0, 0, 6, 5, 2, 0, 0) === -2 && Math.abs(shapeHeight(KIND_CODE.trench, 3, 0, 6, 5, 2, 0, 0) + 1) < 1e-12 && shapeHeight(KIND_CODE.mound, 0, 0, 6, 5, 2, 0, 0) === 2, 'a trench is deepest down its middle, a mound stands up');
  // On a curve: a long thin hole follows the road's bend (its frame is the road's), not the chord.
  const curve = made(drawTrack('bend', 'TEST bend', [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ x: Math.cos(i / 4) * 60, z: Math.sin(i / 4) * 60, y: 10 })), false, ctx));
  const sp = courseSpines(curve)[0];
  const thin = holeOn(curve, { ...base, e: 3, t: 0.5, l: 30, w: 1.4 });
  const sc = new CourseCarve();
  sc.set([thin]);
  const s0 = alongOf(sp, 3, 0.5);
  const at = { e: 0, t: 0 };
  const P = spinePoint();
  locateAlong(sp, s0 + 12, at);
  spineAt(sp, at.e, at.t, P);
  const onArc = sc.carveAt(land(P.x, P.z), P.x, P.z);
  locateAlong(sp, s0, at);
  spineAt(sp, at.e, at.t, P);
  const cx = P.x + P.tx * 12;
  const cz = P.z + P.tz * 12;
  const onChord = sc.carveAt(land(cx, cz), cx, cz);
  ok(Math.abs(onArc - (P.y - 2)) < 1e-6 && onChord > P.y - 1, `a long hole on a curve lies along the road's bend (12 m along the arc ${onArc.toFixed(2)} m, along the chord ${onChord.toFixed(2)} m)`);
  // A node moved bends it with the road: the hole's middle is where its anchor now stands on the spine.
  const moved = made(moveNode(holeOn(sprint, base), undefined, 2, 200, 30, ctx));
  const sm = new CourseCarve();
  sm.set([moved]);
  const msp = courseSpines(moved)[0];
  const g = moved.course!.ground![0];
  locateAlong(msp, alongOf(msp, g.e, g.t), at);
  spineAt(msp, at.e, at.t, P);
  ok(Math.abs(sm.carveAt(land(P.x, P.z), P.x, P.z) - (P.y - 2)) < 1e-9 && sm.carveAt(land(150, 0), 150, 0) !== T - 2 + 0, `a node moved carries the hole with its road (now at ${P.x.toFixed(1)}, ${P.z.toFixed(1)})`);
  // Where two passes meet: a hole on the road over the crossing is never laid where the lower road wins; one on the lower is.
  const sx = new CourseCarve();
  const upHole = made(shapeAdded(over, { ...base, path: 'main', e: 1, t: 0.5 }));
  sx.set([sprint, over]);
  const plainCross = sx.carveAt(land(200, 0), 200, 0);
  sx.set([sprint, upHole]);
  ok(Object.is(sx.carveAt(land(200, 0), 200, 0), plainCross), `a hole on the upper road at a crossing is not laid there (the lower road wins: ${plainCross.toFixed(2)} m)`);
  sx.set([made(shapeAdded(sprint, { ...base, e: 1, t: 1, l: 20 })), over]);
  ok(Math.abs(sx.carveAt(land(200, 0), 200, 0) - (plainCross - 2)) < 1e-9, 'one on the lower road at the crossing is');
  // The editor's own placement: a click on the road anchors a shape there.
  const at2 = shapeAt(sprint, 250, -3);
  ok(typeof at2 !== 'string' && at2.e === 2 && Math.abs(at2.t - 0.5) < 1e-6 && Math.abs(at2.off - 3) < 1e-6, 'a click on the road anchors a new shape to the edge, share and offset under it (right of the road positive)');
  // A stretch deleted takes its shapes; a path deleted, its ground.
  const lastEdge = holeOn(holeOn(sprint, { ...base, e: 3 }), base);
  const cut = made(deleteNode(lastEdge, undefined, 4, ctx));
  ok(cut.course!.ground!.length === 1 && cut.course!.ground![0].e === 1 && /1 shape/.test(groundTakenWords(lastEdge, cut)), `the sprint's last node taken out takes the shape on its last stretch, said ("${groundTakenWords(lastEdge, cut)}")`);
  // A node put in before it renumbers its anchor as a gate's is renumbered, so it keeps its place on the road.
  const ins = made(insertNode(holeOn(sprint, base), undefined, 0, 0.5, ctx));
  ok(ins.course!.ground![0].e === 2 && ins.course!.ground![0].t === 0.5, 'a node put in before a shape renumbers its anchor (edge 1 to 2), its share kept');
  const sc2 = made(shapeAdded(withShortcut, { ...base, path: withShortcut.course!.paths[1].id, e: 0, t: 0.5 }));
  const gone = made(deletePath(sc2, withShortcut.course!.paths[1].id, ctx));
  ok(!gone.course!.ground, 'a shortcut taken out takes its own shapes');
  const set = made(shapeSet(t, 0, { l: 30, h: 5, kind: 'mound' }));
  ok(set.course!.ground![0].l === 30 && set.course!.ground![0].h === 5 && set.course!.ground![0].kind === 'mound' && !made(shapeRemoved(t, 0)).course!.ground, 'a shape is set and taken out');
  // Written one a line, read back, and hashed only where present.
  const txt = trackFileText('w', 'raw', [ramp]);
  const back = readTrackFile(txt, 'w', 'ground').tracks[0];
  ok(trackFileText('w', 'raw', [back]) === txt && trackHash(back) === trackHash(ramp) && trackHash(back) !== trackHash(sprint), 'a shape writes one a line, reads back to the same text and hash, and moves the hash');
  ok(typeof readTrack({ ...JSON.parse(JSON.stringify(ramp)), course: { ...ramp.course, ground: [{ ...ramp.course!.ground![0], e: 9 }] } }) === 'string', 'a shape on an edge its path has not got is refused');
}

// ---------------------------------------------------------------- 4. the brush's cells
{
  const n = 5;
  const cells = new Float32Array(BRUSH_ALONG * n);
  for (let i = 0; i < BRUSH_ALONG; i++) for (let j = 0; j < n; j++) cells[i * n + j] = 0.25 * i - 0.5 * j;
  const d = deflate(cellBytes(cells));
  const chunk: BrushChunk = { path: 'main', k: 1, a: -2, n, d };
  const t = made(readTrack({ ...JSON.parse(JSON.stringify(sprint)), course: { ...sprint.course, brush: [chunk] } }, [], 0));
  const s0 = new CourseCarve();
  s0.set([t]);
  ok(s0.brushMissing === 1 && s0.carveAt(land(40, 0), 40, 0) === 10, 'a chunk never inflated is counted and laid as nothing');
  const primed = await primeBrush([t], inflate);
  ok(primed.inflated === 1 && !primed.failed.length, 'a file read inflates its chunks once');
  const s = new CourseCarve();
  s.set([t]);
  // Cell (i 3, j 1) of chunk 1 is 32 + 6 m along and (a + j) 2 m across: right of +x is -z.
  let worst = 0;
  for (let i = 0; i < BRUSH_ALONG; i++) for (let j = 0; j < n; j++) {
    const x = 32 + 2 * i;
    const z = -2 * (-2 + j);
    worst = Math.max(worst, Math.abs(s.carveAt(land(x, z), x, z) - (10 + cells[i * n + j])));
  }
  ok(worst < 1e-12, 'at each cell of the lattice the road is lowered or raised by the cell itself');
  const mid = s.carveAt(land(33, 1), 33, 1);
  ok(Math.abs(mid - (10 + (cells[0 * n + 1] + cells[1 * n + 1] + cells[0 * n + 2] + cells[1 * n + 2]) / 4)) < 1e-6, 'and between four cells their bilinear mean');
  // A stroke over the road raises its cells; written as a chunk, the carve lays it.
  const ts = new TrackStroke('main', courseSpines(sprint)[0], [], (x, z) => 10 + 0 * land(x, z));
  const ask = { mode: 'raise' as const, cx: 150, cz: 0, radius: 6, hard: 0.5, falloff: 'easeInOut' as const, strength: 1, speed: 2, tau: 0.3, smoothTau: 0.5, flatMode: 'both' as const, height: 0, dt: 0.1 };
  for (let k = 0; k < 10; k++) ts.stamp(ask);
  const map = new Map<number, BrushChunk | null>();
  for (const [k, c] of ts.chunks()) {
    if (!c) continue;
    const dd = deflate(cellBytes(c.cells));
    keepBrushCells(dd, c.cells);
    map.set(k, { path: 'main', k, a: c.a, n: c.n, d: dd });
  }
  const st = made(brushChanged(sprint, 'main', map));
  const ss = new CourseCarve();
  ss.set([st]);
  const up = ss.carveAt(land(150, 0), 150, 0) - 10;
  ok(map.size > 0 && Math.abs(up - 2) < 0.01 && ss.carveAt(land(170, 0), 170, 0) === 10, `a raise held a second over the road raises it there by its speed (${up.toFixed(3)} m) and nowhere past its disc`);
  ok(trackFileText('w', 'raw', [st]).includes('"brush": [') && readTrackFile(trackFileText('w', 'raw', [st]), 'w', 'ground').tracks[0].course!.brush!.length === map.size, 'the stroke writes its chunks, one a line, and reads back');
  // The track's last node taken out takes the chunks past its new end.
  const far = made(brushChanged(sprint, 'main', new Map([[12, { path: 'main', k: 12, a: 0, n: n, d }]])));
  const trimmed = made(deleteNode(far, undefined, 4, ctx));
  ok(!trimmed.course!.brush && /brush chunk/.test(groundTakenWords(far, trimmed)), 'a stretch taken out takes the brush chunks past the path\'s new end');
}

// ---------------------------------------------------------------- 5. the start and the finish
{
  const g = loop.gates;
  const c = made(startHere(loop, 3, ctx));
  ok(c.gates.length === g.length && JSON.stringify(c.gates[0]) === JSON.stringify(g[3]) && JSON.stringify(c.gates[g.length - 3]) === JSON.stringify(g[0]), `a circuit's Start here numbers the gates again from gate 3, none taken out (${c.gates.length})`);
  const sp = courseSpines(loop)[0];
  const ga = alongOf(sp, g[3].e!, g[3].t!);
  const gr = alongOf(sp, c.grid.e!, c.grid.t!);
  const back = (ga - gr + sp.length) % sp.length;
  ok(Math.abs(back - ctx.rules.gridBack) < 0.01 && c.grid.path === 'main', `and lays the grid again ${back.toFixed(2)} m back along the road before it`);
  ok(c.gates.every((k, i) => k.e === g[(i + 3) % g.length].e && k.t === g[(i + 3) % g.length].t), "and keeps every following gate's anchor as it was");
  const sg = sprint.gates;
  const s = made(startHere(sprint, 1, ctx));
  ok(s.gates.length === sg.length - 1 && JSON.stringify(s.gates[0]) === JSON.stringify(sg[1]), "a sprint's Start here takes out the gates before it");
  const f = made(finishHere(sprint, sg.length - 2));
  ok(f.gates.length === sg.length - 1 && JSON.stringify(f.gates[f.gates.length - 1]) === JSON.stringify(sg[sg.length - 2]) && JSON.stringify(f.gates.slice(0, -1)) === JSON.stringify(sg.slice(0, -2)), "a sprint's Finish here takes out the gates after it, every gate between kept");
  ok(typeof startHere(loop, 0, ctx) === 'string' && typeof finishHere(loop, 2) === 'string' && typeof finishHere(sprint, 0) === 'string' && typeof startHere(sprint, sg.length - 1, ctx) === 'string', 'refused in words: gate 0 already the start, a circuit\'s finish, a sprint left one gate');
  // A gate-only track: the grid behind gate 0 along its way.
  const bare = made(readTrack({ id: 'bare', name: 'TEST bare', kind: 'circuit', laps: 1, for: ['podracer'], clear: 0, grid: { x: 0, y: 5, z: -30, q: [1, 0, 0, 0] }, gates: [{ x: 0, y: 7.5, z: 0, q: [1, 0, 0, 0], w: 24, h: 12 }, { x: 0, y: 7.5, z: 200, q: [1, 0, 0, 0], w: 24, h: 12 }, { x: 100, y: 7.5, z: 300, q: [1, 0, 0, 0], w: 24, h: 12 }] }, [], 0));
  const b = made(startHere(bare, 1, ctx));
  ok(b.grid.z === 170 && b.grid.x === 0, `a gate-only track's grid goes ${ctx.rules.gridBack} m back along gate 0's own way`);
}

// ---------------------------------------------------------------- 6. gates of any size
{
  const big = JSON.parse(JSON.stringify(sprint)) as TrackDef;
  big.gates[0].w = TRACK_LIMITS.gateWidthMost;
  big.gates[0].h = TRACK_LIMITS.gateHeightMost;
  ok(typeof readTrack(big) !== 'string', `a gate ${TRACK_LIMITS.gateWidthMost} m wide and ${TRACK_LIMITS.gateHeightMost} m tall reads`);
  big.gates[0].w = TRACK_LIMITS.gateWidthMost + 1;
  ok(typeof readTrack(big) === 'string', 'one wider is refused');
  const road = JSON.parse(JSON.stringify(sprint)) as TrackDef;
  road.course!.paths[0].nodes[1].w = TRACK_LIMITS.widthMost + 1;
  ok(typeof readTrack(road) === 'string', `the road's own width keeps its ${TRACK_LIMITS.widthLeast} to ${TRACK_LIMITS.widthMost} m`);
}

// ---------------------------------------------------------------- 7. a world with no converted terrain: the pole grid lays it
{
  const fol = made(shapeAdded(made(cutRange(sprint, undefined, 0, 4, false, ctx)), { kind: 'hole', path: 'main', e: 1, t: 0.5, off: 0, turn: 0, l: 12, w: 10, h: 2, soft: 0 }));
  const s = new CourseCarve();
  s.set([fol]);
  const grid = new CourseGrid(s);
  grid.all();
  grid.step(Infinity, 0, 0, () => 0);
  const raw = land(150, 0);
  ok(Math.abs(grid.carveAt(raw, 150, 0) - (raw - 2)) < 1e-4 && Object.is(s.carveAt(raw, 150, 0), raw - 2), 'a hole on a road that follows the ground is laid over the raw ground, by the store and by the pole grid');
}

// ---------------------------------------------------------------- 9. the review round
{
  const P = spinePoint();
  const at = { e: 0, t: 0 };
  const sp = courseSpines(sprint)[0];
  spineAt(sp, 1, 0.5, P);
  const hw = P.hw;
  const sh = P.sh;
  const reach = hw + sh;
  const plainS = new CourseCarve();
  plainS.set([sprint]);
  // Finding 1: ground wider than the road eases out across the shoulder, never a cliff at its edge.
  const across = (s: CourseCarve, x: number): { worst: number; mid: number; past: number } => {
    let worst = 0;
    let prev = Number.NaN;
    for (let o = 0; o <= reach + 6; o += 0.05) {
      const g = s.carveAt(land(x, -o), x, -o) - plainS.carveAt(land(x, -o), x, -o);
      if (Number.isFinite(prev)) worst = Math.max(worst, Math.abs(g - prev));
      prev = g;
    }
    return { worst, mid: s.carveAt(land(x, 0), x, 0) - plainS.carveAt(land(x, 0), x, 0), past: s.carveAt(land(x, -(reach + 2)), x, -(reach + 2)) - plainS.carveAt(land(x, -(reach + 2)), x, -(reach + 2)) };
  };
  const mound = new CourseCarve();
  const wideMound = holeOn(sprint, { kind: 'mound', path: 'main', e: 1, t: 0.5, off: 0, turn: 0, l: 20, w: 2 * reach + 20, h: 3, soft: 0 });
  mound.set([wideMound]);
  ok(courseNotes(wideMound, ctx).some((w) => /ground shape 0 reaches 10\.0 m past its road's shoulder/.test(w)) && !courseNotes(holeOn(sprint, { kind: 'hole', path: 'main', e: 1, t: 0.5, off: 0, turn: 0, l: 12, w: 10, h: 2, soft: 0 }), ctx).some((w) => /shoulder: laid/.test(w)), 'a shape reaching past the shoulder is said in the notes, one within it is not');
  const m = across(mound, 150);
  ok(Math.abs(m.mid - 3) < 1e-9 && m.past === 0 && m.worst < 0.15, `a mound 3 m high and wider than the road and its ${sh} m shoulder stands whole on the road and eases out across the shoulder (worst step ${m.worst.toFixed(3)} m a 5 cm, none past it)`);
  const A = Math.ceil((reach + 8) / 2);
  const wideCells = new Float32Array(BRUSH_ALONG * (2 * A + 1)).fill(3);
  const wd = deflate(cellBytes(wideCells));
  keepBrushCells(wd, wideCells);
  const stroke = new CourseCarve();
  stroke.set([made(brushChanged(sprint, 'main', new Map([[4, { path: 'main', k: 4, a: -A, n: 2 * A + 1, d: wd }]])))]);
  const b = across(stroke, 140);
  ok(Math.abs(b.mid - 3) < 1e-9 && b.past === 0 && b.worst < 0.15, `and so does a stroke wider than the road (worst step ${b.worst.toFixed(3)} m a 5 cm)`);
  // The far widening counts as road for the cut, never for the ground: a far tile lays no ground past the shoulder.
  {
    const a = carveAsk();
    const n = 9;
    const raw = new Float32Array(n);
    const o = new Float32Array(n);
    for (let j = 0; j < n; j++) raw[j] = land(150, -(reach + 2) - j * 0.25);
    const lay = (s: CourseCarve) => {
      a.raw = raw;
      a.out = o;
      a.x0 = 150;
      a.dx = 2;
      a.z0 = -(reach + 2);
      a.dz = -0.25;
      a.nx = 1;
      a.nz = n;
      a.widen = sh + 8;
      s.layIn(a);
      return Array.from(o);
    };
    const withMound = lay(mound);
    const without = lay(plainS);
    ok(withMound.every((v, k) => Object.is(v, without[k])), 'a far tile widened past the shoulder lays no ground there');
  }
  // Finding 3: a stroke stays with its stretch: a sprint's node 0 taken out (its first stretch's chunks with it), a node put in
  // before it, a node upstream moved; a circuit's node 0 taken out.
  const two = new Float32Array(BRUSH_ALONG * 7).fill(2);
  const td = deflate(cellBytes(two));
  keepBrushCells(td, two);
  const stroked = made(brushChanged(sprint, 'main', new Map([7, 1].map((k) => [k, { path: 'main', k, a: -3, n: 7, d: td }]))));
  ok(stroked.course!.paths[0].nodes.every((nd, i) => nd.bs === i * 100), "the first stroke written puts the path's lattice on its nodes (their arclengths, to the millimetre)");
  const raised = (t: TrackDef, x: number): number => {
    const s = new CourseCarve();
    s.set([t]);
    return s.carveAt(land(x, 0), x, 0) - 10;
  };
  ok(Math.abs(raised(stroked, 240) - 2) < 1e-9 && Math.abs(raised(stroked, 226) - 2) < 1e-9 && raised(stroked, 330) === 0, 'a stroke stands where it was made (x 224 to 254)');
  const no0 = made(deleteNode(stroked, undefined, 0, ctx));
  ok(Math.abs(raised(no0, 240) - 2) < 1e-9 && Math.abs(raised(no0, 226) - 2) < 1e-9 && raised(no0, 330) === 0, 'node 0 taken out: every other stroke stays where it stood (never slid along the road by the stretch taken out)');
  ok(!no0.course!.brush!.some((c) => c.k === 1) && no0.course!.brush!.some((c) => c.k === 7) && /brush chunk/.test(groundTakenWords(stroked, no0)), "and the stroke on the stretch taken out goes with it, said");
  // A stroke made after (the path's lattice now 100 m on from its node 0) lands where it is made.
  {
    const nsp = courseSpines(no0)[0];
    const ts = new TrackStroke('main', nsp, no0.course!.brush!, () => 10, no0.course!.paths[0].nodes, no0.course!.paths[0].bl);
    const ask = { mode: 'raise' as const, cx: 330, cz: 0, radius: 6, hard: 0.5, falloff: 'easeInOut' as const, strength: 1, speed: 2, tau: 0.3, smoothTau: 0.5, flatMode: 'both' as const, height: 0, dt: 0.1 };
    for (let k = 0; k < 10; k++) ts.stamp(ask);
    const map = new Map<number, BrushChunk | null>();
    for (const [k, c] of ts.chunks()) {
      if (!c) continue;
      const dd = deflate(cellBytes(c.cells));
      keepBrushCells(dd, c.cells);
      map.set(k, { path: 'main', k, a: c.a, n: c.n, d: dd });
    }
    const later = made(brushChanged(no0, 'main', map));
    ok(Math.abs(raised(later, 330) - 2) < 0.01 && Math.abs(raised(later, 240) - 2) < 1e-9 && raised(later, 300) === 0, `a stroke made on the lattice as it stands now raises the road where it is made (x 330: ${raised(later, 330).toFixed(3)} m), the old one kept`);
  }
  const put = made(insertNode(stroked, undefined, 0, 0.5, ctx));
  ok(Math.abs(raised(put, 240) - 2) < 1e-9 && raised(put, 330) === 0 && put.course!.paths[0].nodes[1].bs === 50, 'a node put in before it takes its lattice where it stands, and the stroke stays');
  const bent = made(moveNode(stroked, undefined, 1, 100, 30, ctx));
  ok(Math.abs(raised(bent, 226) - 2) < 0.01 && Math.abs(raised(bent, 240) - 2) < 0.01, 'a node upstream moved (its stretches 9 m longer): the stroke stays with its own stretch');
  const lsp = courseSpines(loop)[0];
  const ringStroke = made(brushChanged(loop, 'main', new Map([[20, { path: 'main', k: 20, a: -3, n: 7, d: td }]])));
  locateAlong(lsp, 650, at);
  spineAt(lsp, at.e, at.t, P);
  const ringAt = (t: TrackDef): number => {
    const s = new CourseCarve();
    const q = new CourseCarve();
    s.set([t]);
    q.set([{ ...t, course: { ...t.course!, brush: undefined } }]);
    return s.carveAt(land(P.x, P.z), P.x, P.z) - q.carveAt(land(P.x, P.z), P.x, P.z);
  };
  const ringNo0 = made(deleteNode(ringStroke, undefined, 0, ctx));
  ok(Math.abs(ringAt(ringStroke) - 2) < 1e-6 && Math.abs(ringAt(ringNo0) - 2) < 0.01 && ringNo0.course!.paths[0].bl === ringStroke.course!.paths[0].bl, `a circuit's node 0 taken out: its stroke stays where it stood, its lattice's period kept (${ringStroke.course!.paths[0].bl} m)`);
  const txt = trackFileText('w', 'raw', [ringNo0]);
  const back = readTrackFile(txt, 'w', 'ground').tracks[0];
  ok(trackFileText('w', 'raw', [back]) === txt && trackHash(back) === trackHash(ringNo0) && /"bl": /.test(txt) && /"bs": /.test(txt), 'the lattice writes on the nodes and the path, reads back to the same text and hash');
  const badRise = JSON.parse(JSON.stringify(ringNo0)) as TrackDef;
  badRise.course!.paths[0].nodes[2].bs = 0;
  const badSome = JSON.parse(JSON.stringify(ringNo0)) as TrackDef;
  delete badSome.course!.paths[0].nodes[3].bs;
  const badBl = JSON.parse(JSON.stringify(ringNo0)) as TrackDef;
  delete badBl.course!.paths[0].bl;
  ok(typeof readTrack(badRise) === 'string' && typeof readTrack(badSome) === 'string' && typeof readTrack(badBl) === 'string', 'a lattice that does not rise, on some nodes only, or a closed path without its period is refused');
  // Finding 4: Place gates again keeps the start and the finish where Start here and Finish here put them.
  const gsp = courseSpines(sprint)[0];
  const alongG = (g: { e?: number; t?: number }) => alongOf(gsp, g.e!, g.t!);
  const started = made(startHere(sprint, 1, ctx));
  const again = made(placeGatesAgain(started, ctx));
  ok(JSON.stringify(again.gates[0]) === JSON.stringify(started.gates[0]) && again.gates.every((g) => alongG(g) >= alongG(started.gates[0]) - 1e-6), `a sprint started at gate 1, gates placed again: no gate comes back before its start (${again.gates.length} gates)`);
  const finished = made(finishHere(sprint, sprint.gates.length - 2));
  const again2 = made(placeGatesAgain(finished, ctx));
  ok(JSON.stringify(again2.gates[again2.gates.length - 1]) === JSON.stringify(finished.gates[finished.gates.length - 1]) && again2.gates.every((g) => alongG(g) <= alongG(finished.gates[finished.gates.length - 1]) + 1e-6), 'and one finished early: none comes back after its finish');
  const ringStart = made(startHere(loop, 3, ctx));
  ok(JSON.stringify(made(placeGatesAgain(ringStart, ctx)).gates) === JSON.stringify(ringStart.gates), "a circuit started at gate 3, gates placed again: its gates as they were, gate 0 the start");
  // Finding 7: on a stretch that follows the ground, a gate and a node put in stand on the land, not the spine's own height.
  const hill = (x: number, z: number): number => 5 + 6 * Math.exp(-((x - 220) * (x - 220)) / 800) + 0 * z;
  const hctx = courseCtx(hill);
  const follow = made(cutRange(sprint, undefined, 0, 4, false, hctx));
  const gate220 = follow.gates.find((g) => Math.abs(g.x - 220) < 1);
  ok(!!gate220 && Math.abs(gate220.y - (hill(220, 0) + hctx.rules.gateLift)) < 0.011, `a gate on a stretch that follows a hill stands on it (${gate220?.y} m, the land ${hill(220, 0).toFixed(2)} m)`);
  const fsp = courseSpines(follow)[0];
  ok(Math.abs(gateOnSpine(fsp, 'main', 2, 0.2, { w: null, h: 12 }, 0, -Infinity, spinePoint(), hill).y - hill(220, 0)) < 0.011 && Math.abs(gateOnSpine(fsp, 'main', 2, 0.2, { w: null, h: 12 }, 0, -Infinity).y - hill(220, 0)) > 1, "the land is the gate's ground there: without it the spine's own height stands metres under the hilltop");
  const inHill = made(insertNode(follow, undefined, 2, 0.2, hctx));
  ok(Math.abs(inHill.course!.paths[0].nodes[3].y - hill(220, 0)) < 0.011 && inHill.course!.paths[0].nodes[3].cut === false, 'a node put in on a following stretch takes the land\'s height');
  ok(JSON.stringify(made(cutRange(sprint, undefined, 0, 4, true, hctx)).gates) === JSON.stringify(made(readTrack(sprint)).gates), 'a course that cuts everywhere places its gates as before, the land never asked');
  // Finding 8: a chunk a held track names is never let go however full the keep, and a stroke over one never read is refused.
  {
    const named = new Float32Array(BRUSH_ALONG).fill(1);
    const nd = deflate(cellBytes(named));
    await primeBrush([{ id: 'heldTrack', course: { brush: [{ path: 'main', k: 0, a: 0, n: 1, d: nd }] } }], inflate);
    keepBrushCells('~loose:0', new Float32Array(BRUSH_ALONG));
    for (let i = 1; i <= CELLS_MOST + 16; i++) keepBrushCells(`~loose:${i}`, new Float32Array(BRUSH_ALONG));
    ok(brushNamed(nd) && !!brushCells(nd) && !brushCells('~loose:0'), `a chunk a held track names outlives ${CELLS_MOST + 16} others kept after it; a loose one is let go`);
    const ts = new TrackStroke('main', courseSpines(sprint)[0], [{ path: 'main', k: 3, a: 0, n: 1, d: 'bm90IGluZmxhdGVk' }], () => 10);
    ok(ts.missing.size === 1 && ts.missing.has(3), 'a stroke over a chunk the track names and nobody read knows it (the sculpt refuses it in words)');
  }
  // Finding 9: one shape edited marks its own stretches, never the whole path's ground.
  {
    const twoHoles = made(shapeAdded(holeOn(loop, { kind: 'hole', path: 'main', e: 1, t: 0.5, off: 0, turn: 0, l: 12, w: 10, h: 2, soft: 0 }), { kind: 'hole', path: 'main', e: 7, t: 0.5, off: 0, turn: 0, l: 12, w: 10, h: 2, soft: 0 }));
    const s = new CourseCarve();
    s.set([twoHoles]);
    const n = s.set([made(shapeSet(twoHoles, 0, { h: 3 }))]);
    locateAlong(lsp, alongOf(lsp, 7, 0.5), at);
    spineAt(lsp, at.e, at.t, P);
    const far = { x: P.x, z: P.z };
    locateAlong(lsp, alongOf(lsp, 1, 0.5), at);
    spineAt(lsp, at.e, at.t, P);
    let farHit = false;
    let nearHit = false;
    for (let i = 0; i < n; i++) {
      const r = s.rects[i];
      if (far.x >= r.x0 && far.x <= r.x1 && far.z >= r.z0 && far.z <= r.z1) farHit = true;
      if (P.x >= r.x0 && P.x <= r.x1 && P.z >= r.z0 && P.z <= r.z1) nearHit = true;
    }
    ok(n > 0 && nearHit && !farHit, `the hole on edge 1 deepened marks its own stretch (${n} rectangles) and not the other hole's on edge 7`);
  }
}

// ---------------------------------------------------------------- 8. the carve allocates nothing with ground and following nodes
// Measured in a process of its own (`measure`), as `courseCarve.test.ts` measures the carve: in this one, after the old
// modules and every other section ran, the lay's own code is compiled round what they left and measures that instead.
{
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const r = spawnSync(process.execPath, ['--max-semi-space-size=64', fileURLToPath(import.meta.url), 'measure'], { encoding: 'utf8' });
  const line = (r.stdout ?? '').split('\n').find((l) => l.startsWith('{')) ?? '{}';
  const m = JSON.parse(line) as { best?: number; poles?: number; moved?: number };
  ok(r.status === 0 && typeof m.best === 'number' && m.best < 0.05 * m.poles!, `the carve lays a block over a ramp, brush cells and following nodes making ${m.best} bytes over ${m.poles} poles, in a process of its own`);
  ok((m.moved ?? 0) > 0, `and it lays something (${m.moved} poles moved)`);
}

console.log(`courseGround: ${checks} checks passed`);

async function measureLay(): Promise<void> {
  const g0 = made(shapeAdded(made(cutRange(loop, undefined, 2, 4, false, ctx)), { kind: 'ramp', path: 'main', e: 1, t: 0.4, off: 2, turn: 10, l: 20, w: 12, h: 3, soft: 2, back: 6 }));
  // And brush cells over the same stretch (chunks 3 to 5 along, every cell across the road).
  const bn = 13;
  const cells = new Float32Array(BRUSH_ALONG * bn).map((_, i) => 0.01 * (i % 7));
  const bd = deflate(cellBytes(cells));
  keepBrushCells(bd, cells);
  const k0 = Math.floor(alongOf(courseSpines(g0)[0], 1, 0.4) / 32);
  const g = made(brushChanged(g0, 'main', new Map([k0 - 1, k0, k0 + 1].map((k) => [k, { path: 'main', k, a: -6, n: bn, d: bd }]))));
  const s = new CourseCarve();
  s.set([g]);
  const a = carveAsk();
  const n = 33;
  const raw = new Float32Array(n * n);
  const o = new Float32Array(n * n);
  const sp = courseSpines(g)[0];
  const at = { e: 0, t: 0 };
  const P = spinePoint();
  locateAlong(sp, alongOf(sp, 1, 0.4), at);
  spineAt(sp, at.e, at.t, P);
  a.raw = raw;
  a.out = o;
  a.x0 = Math.round(P.x) - 32;
  a.dx = 2;
  a.z0 = Math.round(P.z) - 32;
  a.dz = 2;
  a.nx = n;
  a.nz = n;
  a.widen = 0;
  const young = (): number => getHeapSpaceStatistics().find((x) => x.space_name === 'new_space')!.space_used_size;
  // Warmed until the compiler has built the lay (fewer calls measure its own work being compiled).
  for (let k = 0; k < 2500; k++) s.layIn(a);
  let best = Infinity;
  for (let tries = 0; tries < 5; tries++) {
    const before = young();
    for (let k = 0; k < 200; k++) s.layIn(a);
    const d = young() - before;
    if (d >= 0 && d < best) best = d;
  }
  let moved = 0;
  for (let k = 0; k < o.length; k++) if (o[k] !== raw[k]) moved++;
  console.log(JSON.stringify({ best, poles: 200 * n * n, moved }));
}
