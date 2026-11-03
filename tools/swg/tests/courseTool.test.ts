// The race drawer's first wave: the world editor's Course tool (`src/editor/editorCourse.ts`), the real class over a stand-in
// editor whose batches go through the endpoint's own rules (`editsHarness.ts`, the batch's `tracks` kind), driven through its
// own frames (`step`, `overlay`) with a real projection, its keys (`toggle`, `size`, `deleteKey`) and its sections' acts.
// Drawn and closed, a node moved, widened, raised, banked, its shoulder stepped, its curve turned, one put in and one taken
// out, a shortcut started on the road and joined at both ends, a gate moved and pinned, the gates placed again, a course
// drawn from a track's gates; every action one entry of the history, a held edit one action on release; undone to no file
// and done again byte for byte. Nothing here is a copy of the tool's arithmetic: the expected places are the projection's.
//
// Run: node tools/swg/tests/courseTool.test.ts
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeHarness } from './editsHarness.ts';
import { EditorCourse, courseTool, type CourseHost } from '../../../src/editor/editorCourse.ts';
import { toolFrame, type ToolDraw } from '../../../src/editor/tools.ts';
import { courseSpines, readTrack, readTrackFile, trackFileText, type TrackDef } from '../../../src/race/trackFile.ts';
import { nearestOn, rightOf, spineAt, spineNear, spinePoint } from '../../../src/race/coursePath.ts';
import { COURSE_TUNE } from '../../../src/race/courseTune.ts';
import { gameToRawX, gameToRawZ, rawToGameX, rawToGameZ } from '../../../src/story/waypoints.ts';
import type { ScreenView } from '../../../src/editor/gizmo.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const WORLD = 'dantooine';
const CENTRE = { x: 1000, z: -500 };
/** The land in the file's raw frame: a gentle plane, so a node's height says where it was taken. */
const land = (x: number, z: number) => 5 + 0.02 * x - 0.01 * z;

function rig(opts: { tracks?: string | null; kind?: 'ground' | 'space' | 'copies'; race?: boolean } = {}) {
  const h = makeHarness({ world: WORLD, centre: CENTRE, tracks: opts.tracks ?? null });
  let lastText: string | null | undefined;
  let lastTracks: TrackDef[] = [];
  const said: string[] = [];
  const host: CourseHost = {
    get edits() {
      return h.e;
    },
    worldKind: () => opts.kind ?? 'ground',
    raceOn: () => opts.race ?? true,
    // One list a text, as the game's page keeps one list until a landing (the tool compares by identity).
    tracks: () => {
      const text = h.files.tracks ?? null;
      if (text !== lastText) {
        lastText = text;
        lastTracks = text ? readTrackFile(text, WORLD, 'ground').tracks : [];
      }
      return lastTracks;
    },
    toRaw: (x, z, out) => {
      out.x = gameToRawX(CENTRE.x, x);
      out.z = gameToRawZ(CENTRE.z, z);
    },
    toGame: (x, z, out) => {
      out.x = rawToGameX(CENTRE.x, x);
      out.z = rawToGameZ(CENTRE.z, z);
    },
    centre: () => CENTRE,
    land,
    landKnown: land,
    water: () => -Infinity,
    grid: () => 1,
    packId: () => WORLD,
    say: (w) => said.push(w),
    refresh: () => {},
  };
  const c = new EditorCourse(host);
  return { h, c, host, said };
}

/** The course's tracks as the file holds them now. */
const fileTracks = (text: string | null | undefined): TrackDef[] => (text ? readTrackFile(text, WORLD, 'ground').tracks : []);

async function idle(c: EditorCourse, h: { settle(): Promise<void> }): Promise<void> {
  for (let i = 0; i < 60; i++) {
    await h.settle();
    if (!c.busy) return;
  }
}

// ---------------------------------------------------------------- 0. refused where no course is carved

{
  for (const [kind, race, words] of [
    ['space', true, /space is a later pass/],
    ['copies', true, /world of copies/],
    ['ground', false, /race pass is switched off/],
  ] as const) {
    const { c } = rig({ kind, race });
    const said = await c.arm();
    ok(!c.armed && words.test(said), `armed on ${kind}${race ? '' : ' with the race pass off'}: refused in words (${said})`);
  }
  const { c } = rig();
  const t = courseTool(c);
  ok(t.id === 'course' && t.action === 'editorCourse' && t.owns('apply') && t.owns('inverse') && !t.owns('middle') && typeof t.toggle === 'function', "the tool is the list's `course`, on its own key, owning the left and right buttons, with V's toggle");
}

// ---------------------------------------------------------------- the frames

const { h, c } = rig();
const view: ScreenView = h.look(new THREE.Vector3(-100, 420, 330), new THREE.Vector3(-100, 30, 100));
const draw: ToolDraw = { marks: h.marks, radius: 0.5, ring() {} };
const f = toolFrame();
let now = 10;
/** One frame of the tool: its inputs, its step and its overlay from the view. */
function frame(o: { apply?: boolean; inverse?: boolean; lift?: boolean; turn?: boolean; dx?: number; dy?: number; sx?: number; sy?: number; at?: [number, number, number] | null } = {}): void {
  now += 1 / 60;
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
const pt = new Float64Array(3);
/** A point of the game's frame on the screen, CSS pixels. */
function proj(x: number, y: number, z: number): [number, number] {
  const v = new THREE.Vector3(x, y, z).applyMatrix4(new THREE.Matrix4().fromArray(view.vp));
  pt[0] = (v.x * 0.5 + 0.5) * view.w;
  pt[1] = (0.5 - v.y * 0.5) * view.h;
  return [pt[0], pt[1]];
}
const toG = (x: number, z: number) => ({ x: rawToGameX(CENTRE.x, x), z: rawToGameZ(CENTRE.z, z) });
/** A click of the draw mode at a raw point (the aim meets the land there). */
function clickAt(x: number, z: number): void {
  const g = toG(x, z);
  frame({ at: [g.x, land(x, z), g.z] });
  frame({ apply: true, at: [g.x, land(x, z), g.z] });
  frame({ at: [g.x, land(x, z), g.z] });
}
const course = (): TrackDef => {
  const t = fileTracks(h.files.tracks).find((x) => x.id === 'course_1');
  assert.ok(t);
  return t;
};
const node = (i: number, p = 0) => course().course!.paths[p].nodes[i];
const acts = () => h.e.history.actions.length;
const texts: (string | null)[] = [null];
const after = async (what: string, n: number) => {
  await idle(c, h);
  ok(acts() === n, `${what}: one action (${acts()} in the history)`);
  texts.push(h.files.tracks ?? null);
};

// ---------------------------------------------------------------- 1. drawn and closed

await c.arm();
ok(c.armed && c.mode === 'draw', 'armed, in the draw mode');
const ring: [number, number][] = [];
for (let i = 0; i < 8; i++) ring.push([1100 + 150 * Math.cos((i * Math.PI) / 4), -400 + 150 * Math.sin((i * Math.PI) / 4)]);
for (const [x, z] of ring) clickAt(x, z);
ok(c.draft.length === 8 && h.files.tracks === null, 'eight clicks: eight nodes in the draft, nothing written yet');
{
  // The draft drawn: one open line of its eight points and the aim, its first point where the first click landed.
  frame({});
  const m = h.marks;
  let at = 0;
  let line = -1;
  for (let l = 0; l < m.courseLineN; l++) {
    if (m.courseStyle[l] === 9) {
      line = l;
      break;
    }
    at += m.courseSpans[l];
  }
  const g0 = toG(ring[0][0], ring[0][1]);
  const [x0, y0] = proj(g0.x, land(ring[0][0], ring[0][1]), g0.z);
  ok(line >= 0 && m.courseSpans[line] === 8 && Math.abs(m.coursePts[at * 2] - x0) < 0.01 && Math.abs(m.coursePts[at * 2 + 1] - y0) < 0.01, `the draft is drawn through its points from the first click (${m.courseSpans[line]} points)`);
}
// V turns the edge being drawn (the last node's) into a straight, and back.
ok(c.toggle() && c.draft[7].c === 'straight' && c.toggle() && c.draft[7].c === 'smooth', 'V turns the edge being drawn between a straight and a curve');
// RMB takes the last node back; a click puts it back.
frame({ inverse: true });
frame({});
ok(c.draft.length === 7, 'RMB takes the last node back');
clickAt(ring[7][0], ring[7][1]);
clickAt(ring[0][0] + 3, ring[0][1] - 2);
await after('a click near the first node closes and writes a circuit', 1);
{
  const t = course();
  ok(typeof readTrack(t) !== 'string' && t.kind === 'circuit' && t.laps === 3 && t.course!.paths.length === 1 && t.course!.paths[0].nodes.length === 8, `course_1 is a circuit of 8 nodes the reader takes (${t.course!.paths[0].nodes.length})`);
  ok(t.course!.paths[0].nodes.every((n, i) => Math.abs(n.x - ring[i][0]) < 0.006 && Math.abs(n.z - ring[i][1]) < 0.006 && Math.abs(n.y - land(ring[i][0], ring[i][1])) < 0.006 && n.w === COURSE_TUNE.width), 'every node where it was clicked, at the land under it and the tool\'s width');
  ok(t.gates.length >= 3 && t.gates.every((g) => g.path === 'main'), `its gates placed along its road, each following it (${t.gates.length})`);
  ok(c.mode === 'edit' && c.picked === 'course_1', 'written, it is picked and the tool edits it');
}

// ---------------------------------------------------------------- 2. a node moved by its diamond (a held drag, one action)

/** A node's place in the game's frame as the tool draws it (its height and a lift of 0.05 over the road). */
const nodeG = (i: number, p = 0) => {
  const n = node(i, p);
  const g = toG(n.x, n.z);
  return new THREE.Vector3(g.x, n.y + 0.05, g.z);
};
{
  const was = node(2);
  const at = nodeG(2);
  const [sx, sy] = proj(at.x, at.y, at.z);
  frame({ sx, sy });
  frame({ sx, sy, apply: true });
  // The target 20 m off on the ground, at the node's own height, taken by the cursor over several frames.
  const target = new THREE.Vector3(at.x + 12, at.y, at.z - 16);
  for (let k = 1; k <= 5; k++) {
    const p = at.clone().lerp(target, k / 5);
    const [tx, ty] = proj(p.x, p.y, p.z);
    frame({ sx: tx, sy: ty, apply: true });
  }
  ok(acts() === 1, 'nothing written while the drag is held');
  frame({ sx: proj(target.x, target.y, target.z)[0], sy: proj(target.x, target.y, target.z)[1] });
  await after('a node dragged by its diamond over six frames', 2);
  const n = node(2);
  const tx = gameToRawX(CENTRE.x, target.x);
  const tz = gameToRawZ(CENTRE.z, target.z);
  ok(Math.abs(n.x - tx) < 0.02 && Math.abs(n.z - tz) < 0.02 && n.y === was.y, `it stands under the cursor's last place on its own height (${n.x}, ${n.z} against ${tx.toFixed(2)}, ${tz.toFixed(2)})`);
  ok(course().gates.every((g) => g.path === 'main'), 'the following gates follow it still');
}

// ---------------------------------------------------------------- 3. widened by its right grabber

{
  const n = node(2);
  const sp = courseSpines(course())[0];
  const P = spinePoint();
  spineAt(sp, 2, 0, P);
  const r = rightOf(P.tx, P.tz, { x: 0, z: 0 });
  const rg = toG(n.x + r.x * (n.w / 2), n.z + r.z * (n.w / 2));
  const [sx, sy] = proj(rg.x, n.y + 0.05, rg.z);
  frame({ sx, sy });
  frame({ sx, sy, apply: true });
  const out = toG(n.x + r.x * 15, n.z + r.z * 15);
  const [tx, ty] = proj(out.x, n.y + 0.05, out.z);
  frame({ sx: tx, sy: ty, apply: true });
  frame({ sx: tx, sy: ty });
  await after('the road widened by its grabber', 3);
  ok(Math.abs(node(2).w - 30) < 0.03 && Math.abs(node(2).b - n.b) < 0.05, `its full width is twice the grabber's reach (${node(2).w}), the bank kept (${node(2).b})`);
}

// ---------------------------------------------------------------- 3b. banked by its right grabber moved across its line

{
  const n = node(2);
  const sp = courseSpines(course())[0];
  const P = spinePoint();
  spineAt(sp, 2, 0, P);
  const r = rightOf(P.tx, P.tz, { x: 0, z: 0 });
  const lg = toG(n.x - r.x * (n.w / 2), n.z - r.z * (n.w / 2));
  const rg = toG(n.x + r.x * (n.w / 2), n.z + r.z * (n.w / 2));
  const [lx, ly] = proj(lg.x, n.y + 0.05, lg.z);
  const [rx, ry] = proj(rg.x, n.y + 0.05, rg.z);
  const ul = Math.hypot(rx - lx, ry - ly);
  const ux = (rx - lx) / ul;
  const uy = (ry - ly) / ul;
  frame({ sx: rx, sy: ry });
  frame({ sx: rx, sy: ry, apply: true });
  // Thirty pixels across the line on the screen, up from it (the line's own up is (uy, -ux)).
  frame({ sx: rx + 30 * uy, sy: ry - 30 * ux, apply: true });
  frame({ sx: rx + 30 * uy, sy: ry - 30 * ux });
  await after('the road banked by its right grabber', 4);
  const want = n.b + (30 * COURSE_TUNE.bankRate) / 100;
  ok(Math.abs(node(2).b - want) < 0.02 && node(2).b > n.b, `the right grabber moved up the screen raises the driver's right: bank ${n.b} to ${node(2).b} (${want.toFixed(2)} by the screen)`);
}

// ---------------------------------------------------------------- 4. raised with F, banked with R, its shoulder by the wheel

{
  const y0 = node(2).y;
  for (let k = 0; k < 3; k++) frame({ lift: true, dy: -50 });
  ok(acts() === 4 && c.holdsMouse(true, false), 'F held on the picked node takes the mouse and writes nothing yet');
  frame({});
  await after('raised with F', 5);
  ok(Math.abs(node(2).y - (y0 + (150 * COURSE_TUNE.raiseRate) / 100)) < 0.006, `150 px up raises it ${(150 * COURSE_TUNE.raiseRate) / 100} m (${y0} to ${node(2).y})`);
  const b0 = node(2).b;
  for (let k = 0; k < 2; k++) frame({ turn: true, dx: 20 });
  frame({});
  await after('banked with R', 6);
  ok(Math.abs(node(2).b - (b0 - (40 * COURSE_TUNE.bankRate) / 100)) < 0.006, `40 px to the right banks its right side down ${(40 * COURSE_TUNE.bankRate) / 100}° (${b0} to ${node(2).b})`);
  const sh0 = node(2).sh;
  c.size(1);
  c.size(1);
  frame({});
  ok(acts() === 6, 'the wheel with C writes nothing while it turns');
  now += 0.5;
  frame({});
  await after('two notches of shoulder, written as the wheel rests', 7);
  ok(Math.abs(node(2).sh - (sh0 + 2 * COURSE_TUNE.shoulderStep)) < 0.006, `its shoulder ${sh0} to ${node(2).sh}`);
  ok(c.toggle(), 'V on the picked node is taken');
  await after('V turns the edge leaving it', 8);
  ok(node(2).c === 'straight', 'the edge leaving it is a straight');
}

// ---------------------------------------------------------------- 5. a node put in by a click on the road, one taken out

{
  const sp = courseSpines(course())[0];
  const P = spinePoint();
  spineAt(sp, 5, 0.5, P);
  const g = toG(P.x, P.z);
  const [sx, sy] = proj(g.x, P.y, g.z);
  frame({ sx, sy, at: [g.x, P.y, g.z] });
  frame({ sx, sy, apply: true, at: [g.x, P.y, g.z] });
  frame({ sx, sy, at: [g.x, P.y, g.z] });
  await after('a click on the road between two nodes', 9);
  ok(course().course!.paths[0].nodes.length === 9 && c.pickedNode === 6, `a ninth node put in after node 5, and picked (${c.pickedNode})`);
  const put = node(6);
  ok(Math.abs(put.x - P.x) < 0.02 && Math.abs(put.z - P.z) < 0.02, 'it stands where the road was clicked');
  ok(c.deleteKey(), 'Delete on the picked node is taken');
  await after('Delete takes the picked node out', 10);
  ok(course().course!.paths[0].nodes.length === 8, 'eight nodes again');
}

// ---------------------------------------------------------------- 6. a shortcut started on the road and joined at both ends

{
  c.setMode('draw');
  const a = node(0);
  const b = node(4);
  clickAt(a.x, a.z);
  clickAt(1100, -400);
  clickAt(b.x, b.z);
  clickAt(b.x + 2, b.z + 1);
  await after('a shortcut finished near its last node', 11);
  const t = course();
  const cut = t.course!.paths[1];
  ok(t.course!.paths.length === 2 && cut.id === 'cut' && cut.nodes[0].j === 'main' && cut.nodes[cut.nodes.length - 1].j === 'main', 'a second path, joined to the main line at both ends');
  const main = courseSpines(t)[0];
  const near = spineNear();
  nearestOn(main, cut.nodes[0].x, cut.nodes[0].z, near);
  const d0 = near.d;
  const y0 = near.y;
  nearestOn(main, cut.nodes[cut.nodes.length - 1].x, cut.nodes[cut.nodes.length - 1].z, near);
  ok(d0 < 0.02 && near.d < 0.02 && Math.abs(cut.nodes[0].y - y0) < 0.02, `each joined end on the main line's spine at its surface (${d0.toFixed(3)} m, ${near.d.toFixed(3)} m)`);
}

// ---------------------------------------------------------------- 7. a gate moved by its square (pinned), the gates placed again

{
  c.setMode('gates');
  const t = course();
  const i = 1;
  const g = t.gates[i];
  const gg = toG(g.x, g.z);
  const corners = new Float64Array(12);
  // The middle of its window's bottom edge on the screen: the window's own corners, taken from the drawn marks' arrays.
  frame({});
  const m = h.marks;
  let at = 0;
  let found = -1;
  for (let l = 0; l < m.courseLineN; l++) {
    const style = m.courseStyle[l];
    if (style & 0x80) {
      found++;
      if (found === i) {
        for (let k = 0; k < 8; k++) corners[k] = m.coursePts[(at + Math.floor(k / 2)) * 2 + (k & 1)];
        break;
      }
    }
    at += m.courseSpans[l];
  }
  const sx = (corners[0] + corners[2]) / 2;
  const sy = (corners[1] + corners[3]) / 2;
  frame({ sx, sy });
  frame({ sx, sy, apply: true });
  ok(c.pickedGate === i, `a press near its window's outline picks gate ${i} (${c.pickedGate})`);
  // Dragged 10 m over its own level plane: the cursor's ray through the screen point of the place it was grabbed, moved.
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2((sx / view.w) * 2 - 1, 1 - (sy / view.h) * 2);
  const inv = new THREE.Matrix4().fromArray(view.inv);
  const far = new THREE.Vector3(ndc.x, ndc.y, 1).applyMatrix4(inv);
  const eye = new THREE.Vector3(view.ex, view.ey, view.ez);
  ray.set(eye, far.sub(eye).normalize());
  const s = (g.y - eye.y) / ray.ray.direction.y;
  const grab = eye.clone().addScaledVector(ray.ray.direction, s);
  const to = grab.clone().add(new THREE.Vector3(8, 0, 6));
  const [tx, ty] = proj(to.x, to.y, to.z);
  frame({ sx: tx, sy: ty, apply: true });
  frame({ sx: tx, sy: ty });
  await after('a gate dragged by its square', 12);
  const moved = course().gates[i];
  const wantX = g.x - 8;
  const wantZ = g.z + 6;
  ok(moved.path === undefined && Math.abs(moved.x - wantX) < 0.03 && Math.abs(moved.z - wantZ) < 0.03 && moved.y === g.y, `pinned where it was put (${moved.x}, ${moved.z} against ${wantX.toFixed(2)}, ${wantZ.toFixed(2)}), its height kept`);
  void gg;
  await c.gatesAgain();
  await after('Place gates again', 13);
  ok(course().gates.some((x) => x.path === undefined && x.x === moved.x && x.z === moved.z), 'the pinned gate stays where it was put');
  ok(course().gates.filter((x) => x.path !== undefined).length >= 2, 'and the others follow the road');
}

// ---------------------------------------------------------------- 8. the sections' acts: a field is one action

{
  c.setMode('edit');
  c.pickedNode = 3;
  const said = await c.act('course:node:w', '20');
  await after(`the Selected tab's width field (${said})`, 14);
  ok(node(3).w === 20, 'node 3 is 20 m wide');
  await c.act('course:set:name', 'Plains loop');
  await after("the picked course's name", 15);
  ok(course().name === 'Plains loop', 'renamed');
  // The main line moved under the shortcut's joined start (node 0 by 6 m from the console): the joined end follows it onto
  // the moved road, on its spine at its surface, in the same write.
  const n0 = node(0);
  const r = await c.debug({ node: { track: 'course_1', i: 0, x: n0.x + 4, z: n0.z - 4.5 } });
  await after(`the main line moved under a joined end (${r.said.join('; ')})`, 16);
  {
    const t = course();
    const cut = t.course!.paths[1];
    const near = spineNear();
    nearestOn(courseSpines(t)[0], cut.nodes[0].x, cut.nodes[0].z, near);
    ok(near.d < 0.02 && Math.abs(cut.nodes[0].y - near.y) < 0.02 && (Math.abs(cut.nodes[0].x - n0.x) > 0.5 || Math.abs(cut.nodes[0].z - n0.z) > 0.5), `the joined end moved with its road and stands on its spine at its surface (${near.d.toFixed(3)} m off)`);
  }
  const sections = c.toolsSections();
  ok(sections.length === 1 && sections[0].title === 'Course' && (sections[0].rows ?? []).length === 1, "the Tools tab's section names this world's one track");
  ok(c.selectedSections().some((s) => s.title === 'The picked course') && c.selectedSections().some((s) => s.title === 'The picked node'), 'and the Selected tab the picked course and node');
}

// ---------------------------------------------------------------- 9. undone to no file, done again byte for byte

{
  const n = acts();
  for (let k = n; k > 0; k--) {
    await h.e.undo(1);
    await idle(c, h);
    if ((h.files.tracks ?? null) !== texts[k - 1]) assert.fail(`undo to ${k - 1}: the file is not what it was`);
  }
  ok(h.files.tracks === null, `${n} undos put the file back at each step, and the last takes it away`);
  for (let k = 1; k <= n; k++) {
    await h.e.redo(1);
    await idle(c, h);
    if ((h.files.tracks ?? null) !== texts[k]) assert.fail(`redo to ${k}: the file is not what it was`);
  }
  ok(h.files.tracks === texts[n], `and ${n} redos byte for byte`);
}

// ---------------------------------------------------------------- 10. a course drawn from a track's gates

{
  const gates = [
    [0, 0],
    [200, 0],
    [200, 200],
    [0, 200],
  ].map(([x, z]) => ({ x: 2000 + x, y: land(2000 + x, z) + 2.5, z, q: [1, 0, 0, 0], w: 24, h: 8 }));
  // Its own `at`, as every track the endpoint writes carries one (an undo keeps a row's own moment, `keepAt`).
  const loop: TrackDef = { id: 'loop', name: 'Loop', kind: 'circuit', laps: 3, for: ['podracer'], clear: 2, grid: { x: 2000, y: land(2000, -30) + 1, z: -30, q: [1, 0, 0, 0] }, gates, at: 1_700_000_000_000 };
  const text = trackFileText(WORLD, 'raw', [loop]);
  const r = rig({ tracks: text });
  await r.c.arm();
  const said = await r.c.fromGates('loop');
  await idle(r.c, r.h);
  const t = fileTracks(r.h.files.tracks)[0];
  ok(r.h.e.history.actions.length === 1 && !!t.course, `Draw its course from its gates: one action (${said.slice(0, 80)}...)`);
  ok(JSON.stringify(t.gates) === JSON.stringify(gates) && JSON.stringify(t.grid) === JSON.stringify(loop.grid), 'the gates and the grid exactly as they were, none gaining an anchor');
  ok(t.course!.paths[0].nodes.every((n, i) => n.x === gates[i].x && n.z === gates[i].z && Math.abs(n.y - land(n.x, n.z)) < 0.006 && n.w === COURSE_TUNE.width), "a node under each gate at the land and the tool's width");
  await r.h.e.undo(1);
  await idle(r.c, r.h);
  ok(r.h.files.tracks === text, 'undone, the file is its own text again');
}

console.log(`\ncourseTool: ${checks} checks passed`);
