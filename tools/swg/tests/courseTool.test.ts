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
import { turnHeading } from '../../../src/race/gates.ts';
import { trackToSave } from '../../../src/race/trackEdits.ts';
import { keepsNumbering } from '../../../src/editor/courseEdit.ts';
import { toGame } from '../../../src/story/placements.ts';
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

function rig(opts: { tracks?: string | null; kind?: 'ground' | 'space' | 'copies'; race?: boolean; unread?: boolean; water?: (x: number, z: number) => number } = {}) {
  const h = makeHarness({ world: WORLD, centre: CENTRE, tracks: opts.tracks ?? null });
  let lastText: string | null | undefined;
  let lastTracks: TrackDef[] = [];
  const said: string[] = [];
  const bad: string[] = [];
  const host: CourseHost = {
    get edits() {
      return h.e;
    },
    worldKind: () => opts.kind ?? 'ground',
    raceOn: () => opts.race ?? true,
    // One list a text, as the game's page keeps one list until a landing (the tool compares by identity); none where the
    // page has not read the file (`unread`: the race pass switched on after an arrival that read nothing).
    tracks: () => {
      if (opts.unread) return null;
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
    water: opts.water ?? (() => -Infinity),
    grid: () => 1,
    packId: () => WORLD,
    // The editing's own mark of the world, as the game hands the tool the world's generation (`nextWorld` moves it).
    worldMark: () => (h.host as unknown as { worldMark(): number }).worldMark(),
    say: (w, good) => {
      said.push(w);
      if (!good) bad.push(w);
    },
    refresh: () => {},
  };
  const c = new EditorCourse(host);
  return { h, c, host, said, bad };
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
  // Asked once, it writes nothing and says what it would do: carve the world's ground along the line once committed.
  const asked = await r.c.fromGates('loop');
  await idle(r.c, r.h);
  ok(r.h.e.history.actions.length === 0 && r.h.files.tracks === text && /carves dantooine's ground/.test(asked) && /ask again/.test(asked), `Draw its course from its gates asked once writes nothing and says it carves the ground (${asked.slice(0, 90)}...)`);
  // Another track's ask, or the same one past the window, asks again rather than writing.
  const said = await r.c.fromGates('loop');
  await idle(r.c, r.h);
  const t = fileTracks(r.h.files.tracks)[0];
  ok(r.h.e.history.actions.length === 1 && !!t.course, `asked again, it writes: one action (${said.slice(0, 80)}...)`);
  ok(JSON.stringify(t.gates) === JSON.stringify(gates) && JSON.stringify(t.grid) === JSON.stringify(loop.grid), 'the gates and the grid exactly as they were, none gaining an anchor');
  ok(t.course!.paths[0].nodes.every((n, i) => n.x === gates[i].x && n.z === gates[i].z && Math.abs(n.y - land(n.x, n.z)) < 0.006 && n.w === COURSE_TUNE.width), "a node under each gate at the land and the tool's width");
  await r.h.e.undo(1);
  await idle(r.c, r.h);
  ok(r.h.files.tracks === text, 'undone, the file is its own text again');
}

// ---------------------------------------------------------------- 11. in Point, F and R held read the cursor's travel

{
  // The editor hands a tool no mouse movement in Point (`f.dx` and `f.dy` nought): the tool reads the cursor's own travel,
  // up for F and across for R, as the lights tool does.
  const r = rig();
  await r.c.arm();
  await r.c.debug({ draw: { points: [[2000, 0], [2200, 0], [2200, 200], [2000, 200]], closed: true } });
  await idle(r.c, r.h);
  r.c.setMode('edit');
  r.c.pickedPath = 0;
  r.c.pickedNode = 1;
  const g = toolFrame();
  let at = 100;
  const step = (o: { lift?: boolean; turn?: boolean; sx: number; sy: number }) => {
    at += 1 / 60;
    g.apply = false;
    g.inverse = false;
    g.shift = false;
    g.sampled = false;
    g.lift = !!o.lift;
    g.turn = !!o.turn;
    g.dx = 0;
    g.dy = 0;
    g.sx = o.sx;
    g.sy = o.sy;
    g.dt = 1 / 60;
    g.now = at;
    g.valid = false;
    r.c.step(g);
    r.c.overlay(draw, view);
  };
  const one = () => fileTracks(r.h.files.tracks)[0].course!.paths[0].nodes[1];
  const b0 = one().b;
  step({ sx: 400, sy: 300 });
  for (const sx of [400, 420, 440]) step({ turn: true, sx, sy: 300 });
  step({ sx: 440, sy: 300 });
  await idle(r.c, r.h);
  ok(Math.abs(one().b - (b0 - (40 * COURSE_TUNE.bankRate) / 100)) < 0.006, `in Point, R held with the cursor 40 px to the right banks the picked node's right side down (${b0} to ${one().b})`);
  const y0 = one().y;
  for (const sy of [300, 250, 200]) step({ lift: true, sx: 440, sy });
  step({ sx: 440, sy: 200 });
  await idle(r.c, r.h);
  ok(Math.abs(one().y - (y0 + (100 * COURSE_TUNE.raiseRate) / 100)) < 0.006, `and F held with the cursor 100 px up raises it (${y0} to ${one().y})`);
}

// ---------------------------------------------------------------- the review's cases, each on a rig of its own

/** A rig with a circuit of eight nodes drawn from the console (the ring of section 1) and frames of its own, from the same view. */
async function ringRig(o: Parameters<typeof rig>[0] = {}) {
  const r = rig(o);
  await r.c.arm();
  await r.c.debug({ draw: { points: ring, closed: true } });
  await idle(r.c, r.h);
  const v = r.h.look(new THREE.Vector3(-100, 420, 330), new THREE.Vector3(-100, 30, 100));
  const d: ToolDraw = { marks: r.h.marks, radius: 0.5, ring() {} };
  const g = toolFrame();
  let at = 200;
  const fr = (q: { apply?: boolean; lift?: boolean; turn?: boolean; dx?: number; dy?: number; sx?: number; sy?: number; at?: [number, number, number] } = {}): void => {
    at += 1 / 60;
    g.apply = !!q.apply;
    g.inverse = false;
    g.lift = !!q.lift;
    g.turn = !!q.turn;
    g.dx = q.dx ?? 0;
    g.dy = q.dy ?? 0;
    g.sx = q.sx ?? g.sx;
    g.sy = q.sy ?? g.sy;
    g.shift = false;
    g.sampled = false;
    g.dt = 1 / 60;
    g.now = at;
    if (q.at) {
      g.valid = true;
      g.x = q.at[0];
      g.y = q.at[1];
      g.z = q.at[2];
    } else g.valid = false;
    r.c.step(g);
    r.c.overlay(d, v);
  };
  const pr = (x: number, y: number, z: number): [number, number] => {
    const p = new THREE.Vector3(x, y, z).applyMatrix4(new THREE.Matrix4().fromArray(v.vp));
    return [(p.x * 0.5 + 0.5) * v.w, (0.5 - p.y * 0.5) * v.h];
  };
  const trk = () => fileTracks(r.h.files.tracks)[0];
  const nd = (i: number) => trk().course!.paths[0].nodes[i];
  /** A node's grabber (1 the right, -1 the left) where the tool draws it, at its bank's height, on the screen. */
  const grabber = (i: number, side: 1 | -1, out = 0): [number, number] => {
    const n = nd(i);
    const P = spinePoint();
    spineAt(courseSpines(trk())[0], i, 0, P);
    const rr = rightOf(P.tx, P.tz, { x: 0, z: 0 });
    const reach = n.w / 2 + out;
    const gg = toG(n.x + rr.x * side * reach, n.z + rr.z * side * reach);
    return pr(gg.x, n.y + side * (n.w / 2) * Math.tan((n.b * Math.PI) / 180) + 0.05, gg.z);
  };
  /** Gate `i`'s window's bottom edge's middle on the screen, read off the marks a frame drew. */
  const gateMid = (i: number): [number, number] => {
    fr({});
    const m = r.h.marks;
    let k = 0;
    let found = -1;
    for (let l = 0; l < m.courseLineN; l++) {
      if (m.courseStyle[l] & 0x80 && ++found === i) return [(m.coursePts[k * 2] + m.coursePts[(k + 1) * 2]) / 2, (m.coursePts[k * 2 + 1] + m.coursePts[(k + 1) * 2 + 1]) / 2];
      k += m.courseSpans[l];
    }
    throw new Error(`no window of gate ${i} drawn`);
  };
  const n0 = () => r.h.e.history.actions.length;
  const rest = (s: number) => {
    at += s;
  };
  return { ...r, v, fr, pr, trk, nd, grabber, gateMid, n0, rest };
}

// ---------------------------------------------------------------- 12. a grabber dragged up the screen raises the end it is from, either way the road is seen

{
  const q = await ringRig();
  q.c.setMode('edit');
  // Nodes 0 and 4 of the ring are seen from opposite sides in this view: one's width line runs left to right on the screen,
  // the other's right to left (the review's case, where up the screen banked one the other way).
  const runs: string[] = [];
  for (const i of [0, 4]) {
    const L = q.grabber(i, -1);
    const R = q.grabber(i, 1);
    runs.push(R[0] > L[0] ? 'left to right' : 'right to left');
    for (const side of [1, -1] as const) {
      const b0 = q.nd(i).b;
      const [sx, sy] = q.grabber(i, side);
      q.fr({ sx, sy });
      q.fr({ sx, sy, apply: true });
      q.fr({ sx, sy: sy - 30, apply: true });
      q.fr({ sx, sy: sy - 30 });
      await idle(q.c, q.h);
      const b1 = q.nd(i).b;
      ok(side === 1 ? b1 > b0 : b1 < b0, `node ${i} (its line ${runs[runs.length - 1]}): its ${side === 1 ? 'right' : 'left'} grabber dragged 30 px straight up the screen raises its ${side === 1 ? 'right' : 'left'} end (bank ${b0} to ${b1})`);
    }
  }
  ok(runs[0] !== runs[1], `the two nodes' width lines run opposite ways on the screen (${runs.join(', ')})`);
}

// ---------------------------------------------------------------- 13. a click on a grabber only picks; a banked grabber is grabbed where it is drawn

{
  const q = await ringRig();
  q.c.setMode('edit');
  await q.c.debug({ node: { track: 'course_1', i: 4, b: 20 } });
  await idle(q.c, q.h);
  const before = q.n0();
  const text = q.h.files.tracks;
  // A plain click 9 px off node 2's right grabber (within the hover's reach, no drag): it picks node 2 and writes nothing.
  {
    const [sx, sy] = q.grabber(2, 1);
    q.fr({ sx: sx + 9, sy });
    q.fr({ sx: sx + 9, sy, apply: true });
    q.fr({ sx: sx + 9, sy });
    await idle(q.c, q.h);
    ok(q.c.pickedNode === 2 && q.n0() === before && q.h.files.tracks === text, `a plain click a few pixels off a grabber picks its node and writes nothing (${q.n0() - before} actions)`);
  }
  // A plain click exactly on node 4's right grabber where it is drawn, 20 degrees banked: nothing written either.
  {
    const [sx, sy] = q.grabber(4, 1);
    q.fr({ sx, sy });
    q.fr({ sx, sy, apply: true });
    q.fr({ sx, sy });
    await idle(q.c, q.h);
    ok(q.c.pickedNode === 4 && q.n0() === before && q.h.files.tracks === text, `a plain click on a banked node's grabber where it is drawn writes nothing (${q.n0() - before} actions, width ${q.nd(4).w})`);
  }
  // Dragged three metres out along its own level plane (where it is drawn): the road 6 m wider, the grabbed point kept under the cursor.
  {
    const n = q.nd(4);
    const w0 = n.w;
    const P = spinePoint();
    spineAt(courseSpines(q.trk())[0], 4, 0, P);
    const rr = rightOf(P.tx, P.tz, { x: 0, z: 0 });
    const y = n.y + (n.w / 2) * Math.tan((n.b * Math.PI) / 180) + 0.05;
    const from = toG(n.x + rr.x * (n.w / 2), n.z + rr.z * (n.w / 2));
    const to = toG(n.x + rr.x * (n.w / 2 + 3), n.z + rr.z * (n.w / 2 + 3));
    const [sx, sy] = q.pr(from.x, y, from.z);
    const [tx, ty] = q.pr(to.x, y, to.z);
    q.fr({ sx, sy });
    q.fr({ sx, sy, apply: true });
    q.fr({ sx: tx, sy: ty, apply: true });
    q.fr({ sx: tx, sy: ty });
    await idle(q.c, q.h);
    ok(q.n0() === before + 1 && Math.abs(q.nd(4).w - (w0 + 6)) < 0.05, `a banked node's grabber dragged 3 m out widens the road 6 m (${w0} to ${q.nd(4).w}): the grabbed point stays under the cursor`);
  }
  // Pressed nine pixels off node 2's right grabber, out along its width line (still the grabber's, within the hover's reach),
  // and dragged three metres on along the road's right: the road 6 m wider, by the travel from where it was pressed, never
  // by how far the press itself stood from the node (the absolute reach would add twice the press's offset).
  {
    const n = q.nd(2);
    const w0 = n.w;
    const at = q.n0();
    const g2 = toG(n.x, n.z);
    const [nx, ny] = q.pr(g2.x, n.y + 0.05, g2.z);
    const [gx, gy] = q.grabber(2, 1);
    const dl = Math.hypot(gx - nx, gy - ny);
    const sx = gx + ((gx - nx) / dl) * 9;
    const sy = gy + ((gy - ny) / dl) * 9;
    // Where that press meets the grabber's level plane (the node's height: node 2 is not banked), in the game's frame.
    const y = n.y + 0.05;
    const far = new THREE.Vector3((sx / q.v.w) * 2 - 1, 1 - (sy / q.v.h) * 2, 1).applyMatrix4(new THREE.Matrix4().fromArray(q.v.inv));
    const eye = new THREE.Vector3(q.v.ex, q.v.ey, q.v.ez);
    const dir = far.sub(eye).normalize();
    const s = (y - eye.y) / dir.y;
    const hx = gameToRawX(CENTRE.x, eye.x + dir.x * s);
    const hz = gameToRawZ(CENTRE.z, eye.z + dir.z * s);
    const P = spinePoint();
    spineAt(courseSpines(q.trk())[0], 2, 0, P);
    const rr = rightOf(P.tx, P.tz, { x: 0, z: 0 });
    const pressOut = (hx - n.x) * rr.x + (hz - n.z) * rr.z - n.w / 2;
    const to = toG(hx + rr.x * 3, hz + rr.z * 3);
    const [tx, ty] = q.pr(to.x, y, to.z);
    q.fr({ sx, sy });
    q.fr({ sx, sy, apply: true });
    q.fr({ sx: tx, sy: ty, apply: true });
    q.fr({ sx: tx, sy: ty });
    await idle(q.c, q.h);
    ok(q.n0() === at + 1 && pressOut > 1 && Math.abs(q.nd(2).w - (w0 + 6)) < 0.05, `pressed ${pressOut.toFixed(2)} m out from its grabber and dragged 3 m: the road ${w0} to ${q.nd(2).w} m, 6 m wider, the press's own offset never added`);
  }
}

// ---------------------------------------------------------------- 14. the gates mode: a click picks, F and R and C and Follow and Delete each one action

{
  const q = await ringRig();
  q.c.setMode('gates');
  const i = 1;
  const g0 = q.trk().gates[i];
  ok(g0.path === 'main', `gate ${i} follows the road as drawn`);
  const text = q.h.files.tracks;
  const before = q.n0();
  const [sx, sy] = q.gateMid(i);
  // A plain press and release on its window: picked, nothing written, still following.
  q.fr({ sx, sy });
  q.fr({ sx, sy, apply: true });
  q.fr({ sx, sy });
  await idle(q.c, q.h);
  ok(q.c.pickedGate === i && q.n0() === before && q.h.files.tracks === text && q.trk().gates[i].path === 'main', `a plain click on a following gate picks it and writes nothing: it still follows (${q.n0() - before} actions)`);
  // With a hand's jitter of a couple of pixels, the same.
  q.fr({ sx, sy, apply: true });
  q.fr({ sx: sx + 2, sy: sy + 1 });
  await idle(q.c, q.h);
  ok(q.n0() === before && q.h.files.tracks === text, 'a click with two pixels of jitter writes nothing');
  // F and R tapped with no travel of the mouse: nothing (a gate raised or turned by nought would be pinned all the same).
  q.fr({ sx: sx + 2, sy: sy + 1, lift: true });
  q.fr({ sx: sx + 2, sy: sy + 1 });
  q.fr({ sx: sx + 2, sy: sy + 1, turn: true });
  q.fr({ sx: sx + 2, sy: sy + 1 });
  await idle(q.c, q.h);
  ok(q.n0() === before && q.h.files.tracks === text, 'F and R tapped with no travel of the mouse write nothing');
  // C with the wheel on the following gate it picked: widened, still following, its width its own.
  q.c.size(1);
  q.fr({});
  q.rest(0.5);
  q.fr({});
  await idle(q.c, q.h);
  const wide = q.trk().gates[i];
  ok(q.n0() === before + 1 && wide.path === 'main' && wide.ow === 1 && Math.abs(wide.w - (g0.w + COURSE_TUNE.gateWidthStep)) < 0.006, `C with the wheel widens it ${g0.w} to ${wide.w} m: one action, still following, its width its own (ow ${wide.ow})`);
  // F held with the mouse 100 px up: raised by raiseRate, pinned where it is put.
  q.fr({ lift: true, dy: -50 });
  q.fr({ lift: true, dy: -50 });
  q.fr({});
  await idle(q.c, q.h);
  const up = q.trk().gates[i];
  ok(q.n0() === before + 2 && Math.abs(up.y - (wide.y + COURSE_TUNE.raiseRate)) < 0.006 && up.path === undefined, `F held raises it ${wide.y} to ${up.y} (one action) and pins it`);
  // R held with the mouse 40 px right: turned bankRate a hundred pixels.
  q.fr({ turn: true, dx: 20 });
  q.fr({ turn: true, dx: 20 });
  q.fr({});
  await idle(q.c, q.h);
  const turned = q.trk().gates[i];
  const hd = (gq: TrackDef['gates'][number]) => turnHeading(toGame(gq, null, 'raw').q);
  const dh = Math.atan2(Math.sin(hd(turned) - hd(up)), Math.cos(hd(turned) - hd(up)));
  ok(q.n0() === before + 3 && Math.abs(Math.abs(dh) - ((40 * COURSE_TUNE.bankRate) / 100) * (Math.PI / 180)) < 2e-3, `R held turns it ${((Math.abs(dh) * 180) / Math.PI).toFixed(2)}° (one action, ${(40 * COURSE_TUNE.bankRate) / 100}° by the mouse)`);
  // Follow the road: anchored again on its nearest point, on the road at gateLift, its width the road's again.
  await q.c.follow();
  await idle(q.c, q.h);
  const back = q.trk().gates[i];
  const P = spinePoint();
  spineAt(courseSpines(q.trk())[0], back.e!, back.t!, P);
  ok(q.n0() === before + 4 && back.path === 'main' && back.ow === undefined && Math.hypot(back.x - P.x, back.z - P.z) < 0.02 && Math.abs(back.y - (P.y + COURSE_TUNE.gateLift)) < 0.02, `Follow the road anchors it again, on the road at gateLift (one action)`);
  // Delete takes it out.
  const count = q.trk().gates.length;
  ok(q.c.deleteKey(), 'Delete on the picked gate is taken');
  await idle(q.c, q.h);
  ok(q.n0() === before + 5 && q.trk().gates.length === count - 1, `Delete takes it out (${count} to ${q.trk().gates.length} gates, one action)`);
}

// ---------------------------------------------------------------- 15. the wheel's steps go to what they were stepped on

{
  const q = await ringRig();
  q.c.setMode('edit');
  q.c.pickedPath = 0;
  q.c.pickedNode = 2;
  const sh2 = q.nd(2).sh;
  const sh5 = q.nd(5).sh;
  const before = q.n0();
  // A frame first, so the tool's clock is this rig's (the wheel's rest is timed from the frame it was turned on).
  q.fr({});
  q.c.size(1);
  q.c.size(1);
  // Node 5's diamond pressed and held still past the wheel's rest, then let go: node 5 never takes node 2's steps.
  const n5 = q.nd(5);
  const g5 = toG(n5.x, n5.z);
  const [sx, sy] = q.pr(g5.x, n5.y + 0.05, g5.z);
  q.fr({ sx, sy });
  for (let k = 0; k < 40; k++) q.fr({ sx, sy, apply: true });
  q.fr({ sx, sy });
  await idle(q.c, q.h);
  ok(q.c.pickedNode === 5 && q.nd(5).sh === sh5 && q.nd(2).sh === sh2 && q.n0() === before && q.bad.some((w) => /steps given up/.test(w)), `steps taken on node 2, then node 5 held: node 5 keeps its shoulder (${q.nd(5).sh}), node 2's steps are given up and said, nothing written`);
  // Steps on node 5, then a click on the road putting a node in before they rest: the new node keeps the road's shoulder.
  q.c.size(1);
  const P = spinePoint();
  spineAt(courseSpines(q.trk())[0], 6, 0.5, P);
  const gp = toG(P.x, P.z);
  const [rx, ry] = q.pr(gp.x, P.y, gp.z);
  q.fr({ sx: rx, sy: ry, at: [gp.x, P.y, gp.z] });
  q.fr({ sx: rx, sy: ry, apply: true, at: [gp.x, P.y, gp.z] });
  q.fr({ sx: rx, sy: ry, at: [gp.x, P.y, gp.z] });
  await idle(q.c, q.h);
  q.rest(0.5);
  q.fr({ sx: rx, sy: ry });
  await idle(q.c, q.h);
  ok(q.c.pickedNode === 7 && q.n0() === before + 1 && Math.abs(q.nd(7).sh - P.sh) < 0.02 && q.nd(5).sh === sh5, `a node put in meanwhile keeps the road's shoulder (${q.nd(7).sh}) and node 5's steps are given up: one action, the insert`);
  // Steps on node 2, then a real drag of node 2's own diamond let go before they rest: both written, to node 2.
  q.c.pickedNode = 2;
  q.c.size(1);
  const n2 = q.nd(2);
  const g2 = toG(n2.x, n2.z);
  const [ax, ay] = q.pr(g2.x, n2.y + 0.05, g2.z);
  q.fr({ sx: ax, sy: ay });
  q.fr({ sx: ax, sy: ay, apply: true });
  q.fr({ sx: ax + 40, sy: ay, apply: true });
  q.fr({ sx: ax + 40, sy: ay });
  await idle(q.c, q.h);
  q.rest(0.5);
  q.fr({ sx: ax + 40, sy: ay });
  await idle(q.c, q.h);
  ok(q.n0() === before + 3 && Math.abs(q.nd(2).sh - (sh2 + COURSE_TUNE.shoulderStep)) < 0.006, `steps on a node dragged meanwhile are written to it after the drag (${sh2} to ${q.nd(2).sh}, two actions)`);
}

// ---------------------------------------------------------------- 16. a write asked while another is out is refused in words

{
  const q = await ringRig();
  await q.c.debug({ node: { track: 'course_1', i: 2, b: 5 } });
  await idle(q.c, q.h);
  const w3 = q.nd(3).w;
  q.said.length = 0;
  q.bad.length = 0;
  const undo = q.h.e.undo(1);
  const r = await q.c.debug({ node: { track: 'course_1', i: 3, w: 40 } });
  await undo;
  await idle(q.c, q.h);
  ok(r.said.length === 1 && /a write is still going/.test(r.said[0]) && q.bad.length === 1 && !q.said.some((w) => /0 rows written/.test(w)) && q.nd(3).w === w3, `a course edit asked while an undo is out is refused once, in words (${r.said.join('; ')}), never "0 rows written"`);
  // A take-out asked while the tool's own write is out (it holds the tool's writing as every write does).
  const t = q.trk();
  const writing = q.c.debug({ node: { track: 'course_1', i: 3, w: 30 } });
  const gone = await q.c.remove(t.id);
  await writing;
  await idle(q.c, q.h);
  ok(/a write is still going/.test(gone) && q.trk() !== undefined && q.nd(3).w === 30, `a take-out asked while the tool's own write is out is refused too (${gone}), and the write lands`);
}

// ---------------------------------------------------------------- 17. refused before anything is written where the file was not read

{
  const off = rig({ race: false });
  const a = await off.c.debug({ draw: { points: ring, closed: true } });
  ok(off.h.files.tracks === null && a.said.some((w) => /race pass is switched off/.test(w) && /track\(\{ reload: true \}\)/.test(w)), `with the race pass off the console's draw writes nothing (${a.said.join('; ')})`);
  const unread = rig({ unread: true });
  const b = await unread.c.debug({ draw: { points: ring, closed: true } });
  ok(unread.h.files.tracks === null && b.said.some((w) => /not read yet: track\(\{ reload: true \}\)/.test(w)), `and with the file not read, nothing either (${b.said.join('; ')})`);
}

// ---------------------------------------------------------------- 18. a draft from another world is given up

{
  const r = rig();
  await r.c.arm();
  r.c.clickDraw(toG(1000, -400).x, toG(1000, -400).z);
  r.c.clickDraw(toG(1100, -400).x, toG(1100, -400).z);
  r.c.clickDraw(toG(1100, -300).x, toG(1100, -300).z);
  ok(r.c.draft.length === 3, 'three points in the draft on one world');
  r.c.disarm();
  r.h.nextWorld();
  await r.c.arm();
  ok(r.c.draft.length === 0 && r.c.picked === null, 'the editor let go, a world left and the tool armed again: the draft is given up, never written into the new world');
  await r.c.debug({ draw: { points: ring, closed: true } });
  await idle(r.c, r.h);
  ok(r.c.picked === 'course_1', 'a course drawn there is picked');
  r.h.nextWorld();
  const rep = await r.c.debug({});
  ok((rep.tool as { picked: string | null }).picked === null, "and a world left with the editor off lets the console's pick go too");
}

// ---------------------------------------------------------------- 19. the notes through the tool (the host's water)

{
  const q = await ringRig({ water: () => 1000 });
  const notes = (q.c.report() as { notes: string[] }).notes;
  ok(notes.filter((n) => /under the water/.test(n)).length === 8, `the host's water over every node is noted node by node (${notes.length} notes)`);
}

// ---------------------------------------------------------------- 20. the Gates view's save over a course the tool drew again (`trackToSave`)

{
  const q = await ringRig();
  const file0 = q.trk();
  // The Gates view's copy, taken in hand and renamed (unsaved), its gates following the road as it was.
  const held: TrackDef = { ...JSON.parse(JSON.stringify(file0)), name: 'Renamed in hand' };
  await q.c.debug({ node: { track: 'course_1', i: 2, insert: 0.5 } });
  await idle(q.c, q.h);
  const file1 = q.trk();
  ok(file1.course!.paths[0].nodes.length === 9, 'the Course tool put a node in meanwhile');
  const refused = trackToSave(held, file1);
  ok(typeof refused === 'string' && /take it in hand again/.test(refused), `a save whose gates follow the road as it was is refused in words (${typeof refused === 'string' ? refused.slice(0, 70) : 'written'}...)`);
  // Every gate and the grid pinned in hand: the save takes the file's course as it is.
  const pinned: TrackDef = JSON.parse(JSON.stringify(held));
  pinned.gates = pinned.gates.map(({ path: _p, e: _e, t: _t, ow: _o, ...g }) => g);
  const { path: _gp, e: _ge, t: _gt, ...grid } = pinned.grid;
  pinned.grid = grid;
  const kept = trackToSave(pinned, file1);
  ok(typeof kept !== 'string' && JSON.stringify(kept.course) === JSON.stringify(file1.course) && kept.name === 'Renamed in hand' && typeof readTrack(kept) !== 'string', "a track in hand with every gate pinned takes the file's course as it is, and reads");
  ok(trackToSave(held, file0) === held, 'a course unchanged since leaves the track in hand as it is');
}

// ---------------------------------------------------------------- 21. the wheel's steps never land on what was numbered again under them
//
// The steps are kept by the index they were taken on, so every way the course can be numbered again before they rest gives
// them up, said: a node put in before the stepped one with the pick moved onto the new one at the same index, the gates
// placed again, an undo and a console edit landing meanwhile, and a node taken out and another put in at its index.

{
  const given = (b: string[], what: RegExp) => b.some((w) => what.test(w));
  // Steps on node 6, then a click on the road of edge 5: the node put in takes index 6 and the pick moves to it.
  {
    const q = await ringRig();
    q.c.setMode('edit');
    q.c.pickedPath = 0;
    q.c.pickedNode = 6;
    const sh6 = q.nd(6).sh;
    const before = q.n0();
    q.fr({});
    q.c.size(1);
    q.c.size(1);
    const P = spinePoint();
    spineAt(courseSpines(q.trk())[0], 5, 0.5, P);
    const gp = toG(P.x, P.z);
    const [rx, ry] = q.pr(gp.x, P.y, gp.z);
    q.bad.length = 0;
    q.fr({ sx: rx, sy: ry, at: [gp.x, P.y, gp.z] });
    q.fr({ sx: rx, sy: ry, apply: true, at: [gp.x, P.y, gp.z] });
    q.fr({ sx: rx, sy: ry, at: [gp.x, P.y, gp.z] });
    await idle(q.c, q.h);
    q.rest(0.5);
    q.fr({ sx: rx, sy: ry });
    await idle(q.c, q.h);
    ok(
      q.c.pickedNode === 6 && q.trk().course!.paths[0].nodes.length === 9 && q.n0() === before + 1 && Math.abs(q.nd(6).sh - P.sh) < 0.02 && q.nd(7).sh === sh6 && given(q.bad, /shoulder steps given up: the course's nodes were numbered again/),
      `steps on node 6, a node put in on edge 5 (taking index 6, the pick on it) before they rest: the new node keeps the road's shoulder (${q.nd(6).sh}), node 6 now 7 its own (${q.nd(7).sh}), the steps given up and said: one action, the insert`,
    );
  }
  // Place gates again before they rest. Where it adds none (every stretch already has its gate), gate 2 is still the very
  // gate the steps were taken on (a pinned gate raised 7 m, its height the same after), and the steps go to it; where it puts
  // one into a gap before the stepped gate, gate 2 is another gate and none is widened.
  const gateRow = (g: TrackDef['gates'][number]) => JSON.stringify([g.x, g.y, g.z, g.path, g.e, g.t]);
  {
    const q = await ringRig();
    q.c.setMode('gates');
    await q.c.debug({ gate: { track: 'course_1', i: 2, raise: 7 } });
    await idle(q.c, q.h);
    q.c.pickedGate = 2;
    const g2 = q.trk().gates[2];
    const rows = q.trk().gates.map(gateRow).join();
    const before = q.n0();
    q.fr({});
    q.c.size(1);
    q.c.size(1);
    q.bad.length = 0;
    const placing = q.c.gatesAgain();
    q.fr({});
    await placing;
    await idle(q.c, q.h);
    const same = q.trk().gates.map(gateRow).join() === rows;
    q.rest(0.5);
    q.fr({});
    await idle(q.c, q.h);
    const w2 = q.trk().gates[2];
    // A notch grows with the gate (wave 3b): the larger of the tune's step and its share of the width so far.
    const s1 = Math.max(COURSE_TUNE.gateWidthStep, COURSE_TUNE.gateStepShare * g2.w);
    const s2 = Math.max(COURSE_TUNE.gateWidthStep, COURSE_TUNE.gateStepShare * (g2.w + s1));
    ok(
      same && q.n0() === before + 2 && w2.path === undefined && w2.y === g2.y && Math.abs(w2.w - (g2.w + s1 + s2)) < 0.006 && !given(q.bad, /steps given up/),
      `steps on a pinned gate 2, then the gates placed again adding none (every gate where it stood): the same pinned gate widened ${g2.w} to ${w2.w} m at its own height, two actions`,
    );
  }
  {
    const q = await ringRig();
    q.c.setMode('gates');
    await q.c.debug({ gate: { track: 'course_1', i: 1, remove: true } });
    await idle(q.c, q.h);
    const count = q.trk().gates.length;
    q.c.pickedGate = 2;
    const before = q.n0();
    q.fr({});
    q.c.size(1);
    q.c.size(1);
    q.bad.length = 0;
    const placing = q.c.gatesAgain();
    q.fr({});
    await placing;
    await idle(q.c, q.h);
    const placed = JSON.stringify(q.trk().gates.map((g) => g.w));
    q.rest(0.5);
    q.fr({});
    await idle(q.c, q.h);
    ok(
      q.trk().gates.length === count + 1 && q.n0() === before + 1 && JSON.stringify(q.trk().gates.map((g) => g.w)) === placed && given(q.bad, /width steps given up: the course's gates were numbered again/),
      `steps on gate 2, then the gates placed again putting one into the gap before it (${count} to ${q.trk().gates.length} gates): no gate widened, the steps given up and said: one action, the placing`,
    );
  }
  // An undo landing meanwhile: a node put in before the stepped one taken out again under them.
  {
    const q = await ringRig();
    q.c.setMode('edit');
    await q.c.debug({ node: { track: 'course_1', i: 1, insert: 0.5 } });
    await idle(q.c, q.h);
    // Node 5 now is the ring's node 4.
    q.c.pickedPath = 0;
    q.c.pickedNode = 5;
    const ring4 = { x: q.nd(5).x, z: q.nd(5).z, sh: q.nd(5).sh };
    // The history's actions done (an undo leaves the action in the list, to be done again).
    const done = () => q.h.e.history.at;
    const before = done();
    q.fr({});
    q.c.size(1);
    q.bad.length = 0;
    // The rest falls due while the undo is still out: it waits for the undo to land and is judged then, never refused as busy.
    const undo = q.h.e.undo(1);
    q.rest(0.5);
    q.fr({});
    await undo;
    await idle(q.c, q.h);
    q.fr({});
    await idle(q.c, q.h);
    const n4 = q.nd(4);
    ok(
      q.trk().course!.paths[0].nodes.length === 8 && n4.x === ring4.x && n4.z === ring4.z && n4.sh === ring4.sh && q.nd(5).sh === ring4.sh && done() === before - 1 && given(q.bad, /steps given up: the course's nodes were numbered again/) && !given(q.bad, /still going/),
      `steps on node 5, then an undo of a node put in before it, out as they fall due: neither the node they were taken on (now 4) nor the one now at 5 is written, the steps given up as it lands and said (${done() - before} actions done; ${q.bad.join(' | ')})`,
    );
    // And a console edit taking a node out before the stepped one, landing meanwhile.
    q.c.pickedNode = 5;
    const sh5 = q.nd(5).sh;
    const sh6 = q.nd(6).sh;
    const at = done();
    q.fr({});
    q.c.size(1);
    q.bad.length = 0;
    await q.c.debug({ node: { track: 'course_1', i: 1, remove: true } });
    await idle(q.c, q.h);
    q.rest(0.5);
    q.fr({});
    await idle(q.c, q.h);
    ok(
      q.trk().course!.paths[0].nodes.length === 7 && q.nd(4).sh === sh5 && q.nd(5).sh === sh6 && done() === at + 1 && given(q.bad, /steps given up: the course's nodes were numbered again/),
      'steps on node 5, then a node before it taken out from the console: nothing written but the take-out, the steps given up and said',
    );
  }
  // An undo that numbers nothing again (the stepped node's own width put back), still out as the steps fall due: they wait for
  // it to land, then go to the node they were taken on (never refused as a write still going, which would lose them).
  {
    const q = await ringRig();
    q.c.setMode('edit');
    const w5 = q.nd(5).w;
    await q.c.debug({ node: { track: 'course_1', i: 5, w: w5 + 6 } });
    await idle(q.c, q.h);
    q.c.pickedPath = 0;
    q.c.pickedNode = 5;
    const sh5 = q.nd(5).sh;
    q.fr({});
    q.c.size(1);
    q.bad.length = 0;
    const undo = q.h.e.undo(1);
    q.rest(0.5);
    q.fr({});
    await undo;
    await idle(q.c, q.h);
    q.fr({});
    await idle(q.c, q.h);
    ok(
      q.nd(5).w === w5 && Math.abs(q.nd(5).sh - (sh5 + COURSE_TUNE.shoulderStep)) < 0.006 && !given(q.bad, /still going|steps given up/),
      `steps on node 5 and an undo of its own width, out as they fall due: the width put back (${q.nd(5).w}) and the steps written to it after (${sh5} to ${q.nd(5).sh}), nothing refused (${q.bad.join(' | ') || 'nothing said amiss'})`,
    );
  }
  // Delete on the stepped node and a click putting another in at its index: the pick left it the frame after Delete.
  {
    const q = await ringRig();
    q.c.setMode('edit');
    q.c.pickedPath = 0;
    q.c.pickedNode = 3;
    const before = q.n0();
    q.fr({});
    q.c.size(1);
    q.c.size(1);
    q.bad.length = 0;
    ok(q.c.deleteKey(), 'Delete on the stepped node is taken');
    q.fr({});
    await idle(q.c, q.h);
    const P = spinePoint();
    spineAt(courseSpines(q.trk())[0], 2, 0.5, P);
    const gp = toG(P.x, P.z);
    const [rx, ry] = q.pr(gp.x, P.y, gp.z);
    q.fr({ sx: rx, sy: ry, at: [gp.x, P.y, gp.z] });
    q.fr({ sx: rx, sy: ry, apply: true, at: [gp.x, P.y, gp.z] });
    q.fr({ sx: rx, sy: ry, at: [gp.x, P.y, gp.z] });
    await idle(q.c, q.h);
    q.rest(0.5);
    q.fr({ sx: rx, sy: ry });
    await idle(q.c, q.h);
    ok(
      q.c.pickedNode === 3 && q.trk().course!.paths[0].nodes.length === 8 && q.n0() === before + 2 && Math.abs(q.nd(3).sh - P.sh) < 0.02 && given(q.bad, /shoulder steps given up: the pick left that node/),
      `steps on node 3, Delete, and a node put in at index 3: the new node keeps the road's shoulder (${q.nd(3).sh}), the steps given up and said: two actions`,
    );
  }
  // The rule itself (`keepsNumbering`): a node moved where it is keeps the numbering for steps taken on it; one taken out and
  // another put in elsewhere, so the count holds, does not; nor do the gates in another order.
  {
    const q = await ringRig();
    const t = q.trk();
    const moved: TrackDef = JSON.parse(JSON.stringify(t));
    moved.course!.paths[0].nodes[5].x += 7;
    const shifted: TrackDef = JSON.parse(JSON.stringify(t));
    const ns = shifted.course!.paths[0].nodes;
    const gone = ns.splice(2, 1)[0];
    ns.splice(6, 0, { ...gone, x: gone.x + 1 });
    ok(keepsNumbering(t, moved, 'nodes', 0, 5) && !keepsNumbering(t, moved, 'nodes', 0, 4), 'a node moved keeps the numbering for steps on that node; under steps on another it reads as numbered again (read conservatively)');
    ok(shifted.course!.paths[0].nodes.length === t.course!.paths[0].nodes.length && !keepsNumbering(t, shifted, 'nodes', 0, 4), 'a node taken out before the stepped one and another put in after it, the count kept, numbers it again');
    const reordered: TrackDef = JSON.parse(JSON.stringify(t));
    reordered.gates.reverse();
    ok(keepsNumbering(t, t, 'gates', 0, 1) && !keepsNumbering(t, reordered, 'gates', 0, 1), 'the gates in another order, as many, number them again');
  }
}

console.log(`\ncourseTool: ${checks} checks passed`);
