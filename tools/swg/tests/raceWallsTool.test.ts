// The race drawer's third wave: the Course tool's Walls mode (`src/editor/editorWalls.ts`) over the real editing
// (`courseRig.ts`: the endpoint's own batch on file texts), driven through its own frames with a real projection: a wall drawn
// by clicks with an arced edge (V), an edge bent by its middle and its radius typed, a point moved and raised (F), the wall
// leaned (R) and heightened (C with the wheel), a point and a wall taken out (Delete); each one write and one undo, undone to
// the file as it began and done again byte for byte. Then the mode's frame in twelve processes at once (`editorAllocOwn.ts
// course walls`): nothing made.
//
// Run: node tools/swg/tests/raceWallsTool.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { courseRig, idle, land, CENTRE } from './courseRig.ts';
import { toolFrame, type ToolDraw } from '../../../src/editor/tools.ts';
import { readTrackFile, trackFileText, type TrackDef } from '../../../src/race/trackFile.ts';
import { applyTrackOp, trackToSave } from '../../../src/race/trackEdits.ts';
import { readFileSync } from 'node:fs';
import { COURSE_TUNE } from '../../../src/race/courseTune.ts';
import { edgeMiddle, radiusThrough } from '../../../src/race/raceWalls.ts';
import { rawToGameX, rawToGameZ } from '../../../src/story/waypoints.ts';
import type { ScreenView } from '../../../src/editor/gizmo.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// The file as the writer writes it, its track carrying its own `at` (an undo keeps a row's own moment; one with none is put back stamped now).
const start = trackFileText('dantooine', 'raw', readTrackFile(JSON.stringify({ version: 1, world: 'dantooine', frame: 'raw', tracks: [{ id: 'tt', name: 'TEST walls', kind: 'circuit', laps: 2, for: ['podracer'], clear: 4, at: 1700000000000, grid: { x: 1000, y: 10, z: -520, q: [1, 0, 0, 0] }, gates: [{ x: 1000, y: 12, z: -500, q: [1, 0, 0, 0], w: 24, h: 12 }, { x: 1000, y: 12, z: -300, q: [1, 0, 0, 0], w: 24, h: 12 }] }] }), 'dantooine', 'ground').tracks);
const r = courseRig({ tracks: start });
const { h, c } = r;
// The walls stand about (10, 30, 110) of the game's frame (raw x 990 to 1010 mirrored about 1000, z -420 to -340 less -500).
const view: ScreenView = h.look(new THREE.Vector3(0, 160, 260), new THREE.Vector3(5, 25, 110));
const draw: ToolDraw = { marks: h.marks, radius: 0.5, ring() {} };
const f = toolFrame();
let now = 10;
function frame(o: { apply?: boolean; inverse?: boolean; lift?: boolean; turn?: boolean; dx?: number; dy?: number; sx?: number; sy?: number; at?: [number, number, number] | null; dt?: number } = {}): void {
  now += o.dt ?? 1 / 60;
  f.apply = !!o.apply;
  f.inverse = !!o.inverse;
  f.lift = !!o.lift;
  f.turn = !!o.turn;
  f.dx = o.dx ?? 0;
  f.dy = o.dy ?? 0;
  f.sx = o.sx ?? f.sx;
  f.sy = o.sy ?? f.sy;
  f.shift = false;
  f.sampled = false;
  f.dt = 1 / 60;
  f.now = now;
  if (o.at) {
    f.valid = true;
    f.x = o.at[0];
    f.y = o.at[1];
    f.z = o.at[2];
  } else f.valid = false;
  c.step(f);
  c.overlay(draw, view);
}
function proj(x: number, y: number, z: number): [number, number] {
  const v = new THREE.Vector3(x, y, z).applyMatrix4(new THREE.Matrix4().fromArray(view.vp));
  return [(v.x * 0.5 + 0.5) * view.w, (0.5 - v.y * 0.5) * view.h];
}
const toG = (x: number, z: number) => ({ x: rawToGameX(CENTRE.x, x), z: rawToGameZ(CENTRE.z, z) });
/** A click of the walls mode at a raw point (the aim meets the land there, the cursor on it). */
function clickAt(x: number, z: number): void {
  const g = toG(x, z);
  const [sx, sy] = proj(g.x, land(x, z), g.z);
  frame({ at: [g.x, land(x, z), g.z], sx, sy });
  frame({ apply: true, at: [g.x, land(x, z), g.z], sx, sy });
  frame({ at: [g.x, land(x, z), g.z], sx, sy });
}
/** A press on a screen point, the cursor moved to another over a few frames, and let go. */
function dragFrom(a: [number, number], b: [number, number]): void {
  frame({ sx: a[0], sy: a[1] });
  frame({ apply: true, sx: a[0], sy: a[1] });
  for (let k = 1; k <= 4; k++) frame({ apply: true, sx: a[0] + ((b[0] - a[0]) * k) / 4, sy: a[1] + ((b[1] - a[1]) * k) / 4 });
  frame({ sx: b[0], sy: b[1] });
}
const track = (): TrackDef => {
  const t = readTrackFile(h.files.tracks!, 'dantooine', 'ground').tracks.find((k) => k.id === 'tt');
  assert.ok(t);
  return t;
};
const acts = () => h.e.history.actions.length;
const texts: (string | null)[] = [h.files.tracks ?? null];
const after = async (what: string, n: number) => {
  await idle(r);
  ok(acts() === n && r.bad.length === 0, `${what}: one action (${acts()} in the history)${r.bad.length ? ` -- ${r.bad.join('; ')}` : ''}`);
  texts.push(h.files.tracks ?? null);
};

await c.arm();
ok(c.pick('tt').length > 0 && c.setMode('walls').includes('walls'), 'armed, the gate-only track picked, in the Walls mode');

// ---------------------------------------------------------------- 1. drawn: three points, the second edge an arc (V)
clickAt(990, -420);
clickAt(990, -380);
ok(c.toggle() && c.wallsMode.nextArc, 'V turns the edge being drawn into an arc');
clickAt(1010, -350);
ok(c.wallsMode.draft.length === 3 && acts() === 0, 'three clicks: three points in the wall being drawn, nothing written');
clickAt(1010.5, -350.5);
await after('a click near the last point writes the wall', 1);
{
  const w = track().walls?.[0];
  const chord = Math.hypot(1010 - 990, -350 + 380);
  ok(!!w && w.points.length === 3 && w.high === COURSE_TUNE.newWallHigh && w.lean === COURSE_TUNE.newWallLean && w.points[0].r === undefined && Math.abs((w.points[1].r ?? 0) - Math.round(chord * 100) / 100) < 1e-9, `the wall: three points, ${w?.high} m high, its second edge an arc as gentle as its chord (${w?.points[1].r})`);
  ok(w!.points.every((p) => Math.abs(p.y - Math.round(land(p.x, p.z) * 100) / 100) < 1e-9), "each point's foot on the ground under it");
  ok(c.wallsMode.wall === 0, 'the wall drawn is picked');
}

// ---------------------------------------------------------------- 1b. the Gates view's save keeps the file's walls (the review round)
{
  // The track as the Gates view took it in hand before the wall was drawn, renamed in hand: its save takes the walls the
  // file holds now, never none; and one taken in hand with walls saved over a file whose walls were taken out has none.
  const before = readTrackFile(start, 'dantooine', 'ground').tracks[0];
  const now = track();
  const saved = trackToSave({ ...before, name: 'Renamed in hand' }, now);
  ok(typeof saved !== 'string' && JSON.stringify(saved.walls) === JSON.stringify(now.walls) && saved.name === 'Renamed in hand', "the Gates view's save of a track taken in hand before a wall was drawn keeps the wall the file holds");
  const gone = trackToSave(now, before);
  ok(typeof gone !== 'string' && gone.walls === undefined && !('walls' in gone), 'and a save over a file whose walls went has none');
  ok(trackToSave(now, now) === now, 'walls unchanged since: the track in hand as it is');
  // The endpoint's put of a whole track: one omitting walls over a track with walls writes none (`OWN` names them).
  const world = new Map([['dantooine', 'ground' as const]]);
  const { walls: _w, ...bare } = now;
  const put = applyTrackOp({ op: 'put', world: 'dantooine', track: bare }, h.files.tracks!, { worlds: world, now: 1 });
  ok(put.status === 200 && !!put.write && readTrackFile(put.write, 'dantooine', 'ground').tracks[0].walls === undefined, "a put of the track without its walls writes none, never the old track's carried over");
}

// ---------------------------------------------------------------- 2. an edge bent by its middle, and its radius typed
{
  frame({});
  const w = track().walls![0];
  const a = toG(w.points[0].x, w.points[0].z);
  const b = toG(w.points[1].x, w.points[1].z);
  const mid = { x: 0, z: 0 };
  edgeMiddle(a.x, a.z, b.x, b.z, w.points[0].r, mid);
  const y = (w.points[0].y + w.points[1].y) / 2 + 0.05;
  // Six metres to the edge's right as seen in the game.
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const to = { x: mid.x + (-(b.z - a.z) / len) * 6, z: mid.z + ((b.x - a.x) / len) * 6 };
  dragFrom(proj(mid.x, y, mid.z), proj(to.x, y, to.z));
  await after("edge 0's middle dragged six metres to its right", 2);
  const want = radiusThrough(a.x, a.z, b.x, b.z, to.x, to.z)!;
  const got = track().walls![0].points[0].r!;
  ok(got > 0 && Math.abs(got - want) < 0.05 && c.wallsMode.edge === 0, `it bends through the cursor: a radius of ${got} m, positive to its right (${want.toFixed(2)} by the arithmetic)`);
  await c.act('course:wall:r', '-35');
  await after('its radius typed', 3);
  ok(track().walls![0].points[0].r === -35, 'the typed radius written (-35: bulging left)');
  const no = await c.act('course:wall:r', '5');
  ok(/at least half its chord/.test(no) && acts() === 3, `a radius under half its chord refused in words, nothing written (${no})`);
  r.bad.length = 0;
}

// ---------------------------------------------------------------- 3. a point moved, raised (F); the wall leaned (R), heightened (C)
{
  const w = track().walls![0];
  const p0 = toG(w.points[0].x, w.points[0].z);
  const at = proj(p0.x, w.points[0].y + 0.05, p0.z);
  const to = proj(p0.x - 8, w.points[0].y + 0.05, p0.z + 3);
  dragFrom(at, to);
  await after('point 0 dragged', 4);
  const q = track().walls![0].points[0];
  ok(Math.abs(q.x - (w.points[0].x + 8)) < 0.15 && Math.abs(q.z - (w.points[0].z + 3)) < 0.15 && Math.abs(q.y - Math.round(land(q.x, q.z) * 100) / 100) < 1e-9 && c.wallsMode.point === 0, `it moved over the ground (raw ${q.x}, ${q.z}), its foot on the ground there`);
  const y0 = q.y;
  frame({});
  for (let k = 0; k < 5; k++) frame({ lift: true, dy: -20 });
  frame({});
  await after('F held with the mouse up raises its foot', 5);
  ok(Math.abs(track().walls![0].points[0].y - (y0 + (100 * COURSE_TUNE.raiseRate) / 100)) < 0.011, `raised by the raise rate (${y0} to ${track().walls![0].points[0].y} m)`);
  for (let k = 0; k < 5; k++) frame({ turn: true, dx: 30 });
  frame({});
  await after('R held with the mouse right leans the wall', 6);
  ok(Math.abs(track().walls![0].lean - (150 * COURSE_TUNE.bankRate) / 100) < 0.011, `leaned by the bank rate (${track().walls![0].lean}°)`);
  const said = c.size(3);
  for (let k = 0; k < 40; k++) frame({});
  await after('C with three notches of the wheel heightens it, written as the wheel rests', 7);
  ok(!!said && track().walls![0].high === COURSE_TUNE.newWallHigh + 3 * COURSE_TUNE.wallHighStep, `its height ${track().walls![0].high} m (${said})`);
}

// ---------------------------------------------------------------- 4. a point taken out, then the wall
{
  ok(c.wallsMode.point === 0 && c.deleteKey(), 'Delete with point 0 picked');
  await after('the point taken out', 8);
  ok(track().walls![0].points.length === 2 && c.wallsMode.point < 0, 'the wall has two points left, and no point is picked');
  c.wallsMode.point = 1;
  ok(c.deleteKey(), 'Delete with a point of the two-point wall picked');
  await after('the wall goes with it (a wall is two points at least)', 9);
  ok(track().walls === undefined, 'no wall left: the track has no walls at all');
}

// ---------------------------------------------------------------- 5. undone to the file as it began, done again byte for byte
{
  const n = texts.length - 1;
  for (let k = n; k >= 1; k--) {
    await h.e.undo(1);
    await idle(r);
    if ((h.files.tracks ?? null) !== texts[k - 1]) assert.fail(`undo to ${k - 1}: the file is not what it was`);
  }
  ok(h.files.tracks === start, `${n} undos put the file back at each step, the last to the file as it began`);
  for (let k = 1; k <= n; k++) {
    await h.e.redo(1);
    await idle(r);
    if ((h.files.tracks ?? null) !== texts[k]) assert.fail(`redo to ${k}: the file is not what it was`);
  }
  ok(h.files.tracks === texts[n], `and ${n} redos byte for byte`);
}

// ---------------------------------------------------------------- 6. the console's walls
{
  const out = await c.debug({ walls: { track: 'tt', add: { name: 'Console wall', high: 3, lean: -10, points: [[990, -420], [990, -380, 9, 30], [1000, -340]] } } });
  await idle(r);
  const w = track().walls?.[0];
  ok(!!w && w.name === 'Console wall' && w.high === 3 && w.lean === -10 && w.points[1].r === 30 && w.points[1].y === 9, `course({ walls: { add } }) draws a wall (${out.said.join('; ')})`);
  await c.debug({ walls: { track: 'tt', i: 0, set: { lean: 20 } } });
  await idle(r);
  await c.debug({ walls: { track: 'tt', i: 0, set: { point: 1, r: null } } });
  await idle(r);
  ok(track().walls![0].lean === 20 && track().walls![0].points[1].r === undefined, "and sets a wall's numbers and straightens an edge");
  await c.debug({ walls: { track: 'tt', add: { points: [[995, -420], [995, -390]] } } });
  await idle(r);
  await c.debug({ walls: { track: 'tt', i: 1, remove: true } });
  await idle(r);
  ok(track().walls?.length === 1, 'and takes one out');
  c.wallsMode.wall = 0;
  c.wallsMode.point = -1;
  ok(c.deleteKey(), 'Delete with the wall picked and no point');
  await idle(r);
  ok(track().walls === undefined, 'takes the wall out');
}

// ---------------------------------------------------------------- 6b. a two-point wall's point taken out picks nothing after it (the review round)
{
  const two = async () => {
    await c.debug({ walls: { track: 'tt', add: { name: 'First', points: [[990, -420], [990, -380]] } } });
    await idle(r);
    await c.debug({ walls: { track: 'tt', add: { name: 'Second', points: [[1000, -420], [1000, -380]] } } });
    await idle(r);
  };
  await two();
  c.wallsMode.wall = 0;
  c.wallsMode.point = 1;
  c.wallsMode.edge = 0;
  ok(c.deleteKey(), "Delete with a point of the first, two-point wall picked");
  await idle(r);
  ok(track().walls?.length === 1 && track().walls![0].name === 'Second' && c.wallsMode.wall === -1 && c.wallsMode.point === -1 && c.wallsMode.edge === -1, 'the first wall went whole, and nothing is picked: the second, now in its index, is not');
  ok(!c.deleteKey(), 'a second Delete takes nothing');
  await idle(r);
  ok(track().walls?.length === 1, 'the second wall stands');
  // The Selected tab's own: "Take the point out" the same.
  await c.debug({ walls: { track: 'tt', i: 0, remove: true } });
  await idle(r);
  await two();
  c.wallsMode.wall = 0;
  c.wallsMode.point = 0;
  await c.act('course:wall:removePoint');
  await idle(r);
  ok(track().walls?.length === 1 && track().walls![0].name === 'Second' && c.wallsMode.wall === -1 && c.wallsMode.point === -1, "the Selected tab's take-out of a two-point wall's point picks nothing after it");
  await c.debug({ walls: { track: 'tt', i: 0, remove: true } });
  await idle(r);
  ok(track().walls === undefined, 'cleared');
  // Each point's post stands at the sample the view made for it with the view (`ks`), never found by place every frame.
  const ew = readFileSync(new URL('../../../src/editor/editorWalls.ts', import.meta.url), 'utf8');
  ok(/const k = v\.ks\[j\];/.test(ew) && /ks\[j \+ 1\] = xs\.length - 1;/.test(ew) && !/sampleOfPoint/.test(ew), "the Walls mode's frame reads each point's sample from its view (`ks`), made with the view");
}

// ---------------------------------------------------------------- 7. the mode's frame makes nothing: twelve processes at once
{
  const file = fileURLToPath(new URL('./editorAllocOwn.ts', import.meta.url));
  const one = () =>
    new Promise<{ frames: number; wallsMade: number; wallsScavenges: number; lines: number; marks: number; views: number; skipped?: string }>((res, rej) => {
      const child = spawn(process.execPath, ['--expose-gc', '--allow-natives-syntax', file, 'course', 'walls'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.on('close', (code) => {
        const line = out.trim().split('\n').pop() ?? '';
        if (code !== 0) return rej(new Error(`the walls frame measure exited ${code}: ${line}`));
        try {
          res(JSON.parse(line));
        } catch {
          rej(new Error(`the walls frame measure printed nothing that reads: ${line || '(nothing)'}`));
        }
      });
    });
  const all = await Promise.all(Array.from({ length: 12 }, () => one()));
  for (let i = 0; i < all.length; i++) {
    const a = all[i];
    if (a.skipped) {
      console.log(`note process ${i + 1} skipped: ${a.skipped}`);
      continue;
    }
    // The harness's own constant (2496 bytes) is the line, as every editor frame measure's.
    ok(a.views === 2 && a.lines > 16 && a.marks === 22 && a.wallsScavenges === 0 && a.wallsMade <= 0.025 * a.frames, `the Walls mode's frame, process ${i + 1} of 12: ${Math.max(0, a.wallsMade)} bytes over ${a.frames} frames, no collection (two walls drawn, ${a.marks} handles)`);
  }
}

console.log(`\nraceWallsTool: ${checks} checks passed`);
