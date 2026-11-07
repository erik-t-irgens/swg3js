// The race drawer's wave 3b, its editor half: the Course tool (`editorCourse.ts`) over the real editing (`courseRig.ts`: the
// endpoint's own batch on file texts): Start here and Finish here, a node made to follow the land and a range, a gate 300 m
// wide, holes and ramps put down, set and taken out (the Ground mode's console), a node moved under them, and the sculpt
// brush's "This track" stroke onto the picked course (`editorSculpt.ts`, `trackBrush.ts`), which never writes the heights
// file; each one write and one undo, undone to the file as it began and done again byte for byte. Then the Ground mode's frame
// in twelve processes at once (`editorAllocOwn.ts course ground`): nothing made.
//
// Run: node tools/swg/tests/courseGroundTool.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { courseRig, idle, CENTRE, land } from './courseRig.ts';
import { readTrackFile, type TrackDef } from '../../../src/race/trackFile.ts';
import { EditorSculpt } from '../../../src/editor/editorSculpt.ts';
import { CourseGround, sameShape } from '../../../src/editor/editorGround.ts';
import { SCULPT_TUNE } from '../../../src/editor/editorTune.ts';
import { HeightEdits } from '../../../src/swg/terrain/heightEdits.ts';
import { gameToRawX, gameToRawZ, rawToGameX, rawToGameZ } from '../../../src/story/waypoints.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const r = courseRig({ tracks: null });
const { h, c } = r;
const texts: (string | null)[] = [h.files.tracks ?? null];
const track = (id: string): TrackDef => readTrackFile(h.files.tracks!, 'dantooine', 'ground').tracks.find((t) => t.id === id)!;
const step = async (o: Record<string, unknown>, what: string, check: (said: string[]) => boolean): Promise<void> => {
  const out = await c.debug(o);
  await idle(r);
  ok(check(out.said), `${what} (${out.said.join('; ').slice(0, 160)})`);
  texts.push(h.files.tracks ?? null);
};

// A circuit about (1000, -300) of the raw frame, and a sprint beside it.
const ring = Array.from({ length: 10 }, (_, i) => [1000 + Math.cos((i / 10) * Math.PI * 2) * 200, -300 + Math.sin((i / 10) * Math.PI * 2) * 200]);
await step({ draw: { points: ring, closed: true, name: 'TEST ring' } }, 'a circuit drawn', () => !!track('course_1'));
await step({ draw: { points: [200, 400, 600, 800, 1000, 1200, 1400].map((x) => [x, -700]), closed: false, name: 'TEST lane' } }, 'a sprint drawn', () => track('course_2')?.gates.length >= 5);
const ringGates = track('course_1').gates;
await step({ start: { track: 'course_1', gate: 2 } }, 'Start here on the circuit', () => JSON.stringify(track('course_1').gates[0]) === JSON.stringify(ringGates[2]) && track('course_1').gates.length === ringGates.length);
const laneGates = track('course_2').gates;
await step({ start: { track: 'course_2', gate: 1 } }, "Start here on the sprint takes out the gates before it", () => track('course_2').gates.length === laneGates.length - 1);
const l2 = track('course_2').gates.length;
await step({ finish: { track: 'course_2', gate: l2 - 2 } }, 'Finish here on the sprint takes out the gates after it', () => track('course_2').gates.length === l2 - 1);
await step({ set: { track: 'course_1', node: 2, cut: false } }, 'a node made to follow the land, its height the land’s', () => {
  const n = track('course_1').course!.paths[0].nodes[2];
  return n.cut === false && Math.abs(n.y - land(n.x, n.z)) < 0.006;
});
await step({ cut: { track: 'course_1', from: 4, to: 5, cut: false } }, 'Follow the land over nodes 4 to 5', () => track('course_1').course!.paths[0].nodes.filter((n) => n.cut === false).length === 3);
await step({ gate: { track: 'course_1', i: 1, w: 300, h: 150 } }, 'a gate 300 m wide and 150 m tall', () => track('course_1').gates[1].w === 300 && track('course_1').gates[1].h === 150);
const n0 = track('course_1').course!.paths[0].nodes[0];
const n1 = track('course_1').course!.paths[0].nodes[1];
const mid = [(n0.x + n1.x) / 2, (n0.z + n1.z) / 2];
await step({ ground: { track: 'course_1', add: { at: mid, kind: 'hole', l: 14, w: 10, h: 2 } } }, 'a hole put down on the road', () => track('course_1').course!.ground?.[0]?.kind === 'hole');
await step({ ground: { track: 'course_1', add: { at: [mid[0] + 1, mid[1] + 1], kind: 'ramp', h: 3, back: 5 } } }, 'a ramp put down beside it', () => track('course_1').course!.ground?.[1]?.kind === 'ramp' && track('course_1').course!.ground![1].back === 5);
await step({ ground: { track: 'course_1', i: 0, set: { l: 20 } } }, 'the hole lengthened', () => track('course_1').course!.ground![0].l === 20);
// The sculpt brush's This track stroke onto the picked course: its brush, never the world's heights file.
{
  c.pick('course_1');
  const store = new HeightEdits();
  const sculpt = new EditorSculpt({
    edits: h.e,
    worldKind: () => 'ground',
    store: () => store,
    rawAt: (px, pz) => land(px * 2, pz * 2),
    toRaw: (x, z, out) => {
      out.x = gameToRawX(CENTRE.x, x);
      out.z = gameToRawZ(CENTRE.z, z);
    },
    toGame: (x, z, out) => {
      out.x = rawToGameX(CENTRE.x, x);
      out.z = rawToGameZ(CENTRE.z, z);
    },
    changed: () => {},
    feet: () => {},
    standing: () => [],
    lowestOf: () => null,
    fileRow: () => null,
    fileSize: () => ({ tiles: 0, bytes: 0 }),
    deflate: async (b) => deflateRawSync(Buffer.from(b)).toString('base64'),
    beginWork() {},
    noteStamp() {},
    say() {},
    track: { track: () => c.track(), groundAt: (x, z) => land(x, z), preview: (t, fx, fz) => c.previewTrack(t, fx, fz), write: (l, b, a) => c.write(l, b, a), ok: () => c.last.ok },
  });
  SCULPT_TUNE.thisTrack = true;
  const heightsBefore = h.files.heights ?? null;
  const said = await sculpt.strokeAt('raise', rawToGameX(CENTRE.x, mid[0]), rawToGameZ(CENTRE.z, mid[1]), 6, 1);
  await idle(r);
  SCULPT_TUNE.thisTrack = false;
  const b = track('course_1').course!.brush;
  ok(!!b?.length && (h.files.heights ?? null) === heightsBefore && store.size === 0, `a This track stroke writes the picked course's brush (${b?.length} chunks) and never the heights file (${said})`);
  ok(r.carves.some((k) => k.preview), 'and carved a preview while it was held');
  texts.push(h.files.tracks ?? null);
}
const anchor = JSON.stringify(track('course_1').course!.ground!.map((s) => [s.e, s.t]));
await step({ node: { track: 'course_1', i: 1, x: n1.x + 20, z: n1.z + 10 } }, 'a node moved under the hole', () => JSON.stringify(track('course_1').course!.ground!.map((s) => [s.e, s.t])) === anchor && !!track('course_1').course!.brush?.length);
await step({ ground: { track: 'course_1', i: 1, remove: true } }, 'the ramp taken out', () => track('course_1').course!.ground!.length === 1);

// ---------------------------------------------------------------- undone to the file as it began, done again byte for byte
{
  const n = texts.length - 1;
  for (let k = n; k >= 1; k--) {
    await h.e.undo(1);
    await idle(r);
    if ((h.files.tracks ?? null) !== texts[k - 1]) assert.fail(`undo to ${k - 1}: the file is not what it was`);
  }
  ok((h.files.tracks ?? null) === texts[0], `${n} undos put the file back at each step, the last to the file as it began`);
  for (let k = 1; k <= n; k++) {
    await h.e.redo(1);
    await idle(r);
    if ((h.files.tracks ?? null) !== texts[k]) assert.fail(`redo to ${k}: the file is not what it was`);
  }
  ok((h.files.tracks ?? null) === texts[n], `and ${n} redos byte for byte`);
}

// ---------------------------------------------------------------- the review round: a range's mark and the wheel's steps are things
{
  // A range's first node is marked on what it was taken on: given up in words on another track, or once the nodes were
  // numbered again; used, it is let go.
  const fileNow = () => h.files.tracks ?? null;
  c.pick('course_1');
  c.setMode('edit');
  c.pickedPath = 0;
  c.pickedNode = 2;
  await c.act('course:node:mark');
  c.pick('course_2');
  c.setMode('edit');
  c.pickedPath = 0;
  c.pickedNode = 3;
  const before = fileNow();
  const other = await c.act('course:node:followRange');
  await idle(r);
  ok(/marked on another track or path/.test(other) && fileNow() === before && c.rangeFrom === -1, `a mark taken on another track is given up in words, nothing written (${other})`);
  c.pickedNode = 4;
  await c.act('course:node:mark');
  c.pickedNode = 0;
  await c.act('course:node:remove');
  await idle(r);
  c.pickedNode = 2;
  const before2 = fileNow();
  const renum = await c.act('course:node:followRange');
  await idle(r);
  ok(/numbered again/.test(renum) && fileNow() === before2, `a mark the nodes were numbered again under is given up in words (${renum})`);
  // Two tracks alike node for node: a mark taken on one still names nothing on the other.
  const twin = [200, 400, 600, 800].map((x) => [x, -1200]);
  await step({ draw: { points: twin, closed: false, name: 'TEST twin a', track: 'twin_a' } }, 'a sprint drawn', () => !!track('twin_a'));
  await step({ draw: { points: twin, closed: false, name: 'TEST twin b', track: 'twin_b' } }, 'and its twin', () => !!track('twin_b'));
  c.pick('twin_a');
  c.setMode('edit');
  c.pickedPath = 0;
  c.pickedNode = 1;
  await c.act('course:node:mark');
  c.pick('twin_b');
  c.setMode('edit');
  c.pickedPath = 0;
  c.pickedNode = 3;
  ok(c.rangeFrom === -1, "a mark taken on a track is no mark on its twin, node for node alike");
  c.pick('course_2');
  c.setMode('edit');
  c.pickedPath = 0;
  c.pickedNode = 1;
  await c.act('course:node:mark');
  c.pickedNode = 3;
  ok(c.rangeFrom === 1, 'a fresh mark stands while nothing renumbers it');
  await c.act('course:node:followRange');
  await idle(r);
  const ns = track('course_2').course!.paths[0].nodes;
  ok(ns[1].cut === false && ns[2].cut === false && ns[3].cut === false && c.rangeFrom === -1, 'and Follow the land over it writes nodes 1 to 3 and lets the mark go');
}
{
  // The Ground mode's wheel steps belong to the shape they were taken on: another shape at that index, as many shapes, gives
  // them up in words; the same shape in a row an unrelated edit made keeps them.
  let cur: TrackDef = track('course_1');
  const writes: string[] = [];
  const says: string[] = [];
  const g = new CourseGround({ track: () => cur, tracksNow: () => [cur], write: async (l) => (writes.push(l), l), busyNow: () => false, groundY: () => 0, pickRoad() {}, toRaw: (x, z, o) => ((o.x = x), (o.z = z), undefined), toGame: (x, z, o) => ((o.x = x), (o.z = z), undefined), say: (w) => says.push(w), refresh() {} });
  const f = { lift: false, turn: false, apply: false, now: 1 } as unknown as Parameters<CourseGround['frame']>[0];
  const none = {} as never;
  g.shape = 0;
  g.size(2, 0);
  const swapped = JSON.parse(JSON.stringify(cur)) as TrackDef;
  swapped.course!.ground![0] = { ...swapped.course!.ground![0], kind: 'mound', h: 1 };
  cur = swapped;
  g.frame(f, none, none, none, false, false, false, false);
  ok(writes.length === 0 && says.some((w) => /given up/.test(w)), "a wheel's steps over a shape another took the place of are given up in words, nothing written");
  cur = track('course_1');
  g.shape = 0;
  g.size(2, 2);
  cur = JSON.parse(JSON.stringify(cur)) as TrackDef;
  g.frame({ ...f, now: 3 } as typeof f, none, none, none, false, false, false, false);
  ok(writes.length === 1 && sameShape(cur.course!.ground![0], track('course_1').course!.ground![0]), 'and over the same shape in a new row they are written as the wheel rests');
}

// ---------------------------------------------------------------- the Ground mode's frame makes nothing: twelve processes at once
// (`SWG3JS_QUICK=1` leaves it out: a mutation run's, never the suite's.)
if (process.env.SWG3JS_QUICK !== '1') {
  const file = fileURLToPath(new URL('./editorAllocOwn.ts', import.meta.url));
  const one = () =>
    new Promise<{ frames: number; groundMade: number; groundScavenges: number; lines: number; marks: number; shapes: number }>((res, rej) => {
      const child = spawn(process.execPath, ['--expose-gc', '--allow-natives-syntax', file, 'course', 'ground'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.on('close', (code) => {
        const line = out.trim().split('\n').pop() ?? '';
        if (code !== 0) return rej(new Error(`the ground frame measure exited ${code}: ${line}`));
        try {
          res(JSON.parse(line));
        } catch {
          rej(new Error(`the ground frame measure printed nothing that reads: ${line || '(nothing)'}`));
        }
      });
    });
  const all = await Promise.all(Array.from({ length: 12 }, () => one()));
  for (let i = 0; i < all.length; i++) {
    const a = all[i];
    ok(a.shapes === 4 && a.marks >= 4 && a.groundScavenges === 0 && a.groundMade <= 0.025 * a.frames, `the Ground mode's frame, process ${i + 1} of 12: ${Math.max(0, a.groundMade)} bytes over ${a.frames} frames, no collection (four shapes drawn, ${a.marks} handles)`);
  }
}

console.log(`\ncourseGroundTool: ${checks} checks passed`);
