// The world editor's lights tool (Map-maker II's wave of the rooms' lights), driven as the game drives it: the real
// `EditorLights` over the real editing (`EditorEdits`, its every batch the endpoint's own rules on file texts, `editsHarness.ts`),
// with a building of our own round the camera. Held:
//
//   1. A preset put down in a room at each scope: one row of the right file, read back by the files' own reader; one undo puts
//      the files back byte for byte (the file gone with its last row), one redo writes the very text again.
//   2. A light of ours picked by a click on its marker, moved by the gizmo's ground square, raised by F held, turned by R held,
//      nudged and duplicated: each one write and one undo, the hand's light handed to the pool while it moves.
//   3. One of the game's own lights edited at the tool's scope (off, scaled, a shadow asked for), its edit merged, cleared.
//   4. The room's fill, a type changed (a spot's cone, a directional's reach), a scope moved (two files, one action).
//   5. Outdoors a light is a mark that lights nothing, said in words; the world of copies has no outdoors.
//   6. The wiring only the game makes, pinned as text: the tool on the list, its key, the window's sections, the library's
//      Lights source, the keys it claims.
//
// Run: node tools/swg/tests/editorLights.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { makeHarness, propRow } from './editsHarness.ts';
import type { PlacementRow } from '../../../src/story/placements.ts';
import { EditorLights, LIGHTS_TOOL_TUNE, LIGHT_PRESETS, colourOfHex, fileOfScope, hexOfColour, lightsTool, presetOf, turnToward, type LightsBuilding, type LightsHost, type LiveLight } from '../../../src/editor/editorLights.ts';
import { readLightsFile, type LightRow } from '../../../src/world/editFiles/lightsFile.ts';
import { DEFAULT_POOL, planRoomLights, shineOf, type PoolShape } from '../../../src/world/roomLights.ts';
import { DEFAULT_REACH } from '../../../src/story/lightSpec.ts';
import { RoomLightEdits } from '../../../src/world/roomLightEdits.ts';
import { roomPoolShape } from '../../../src/world/roomLightPool.ts';
import { toolFrame } from '../../../src/editor/tools.ts';
import { lightEntries, isLightEntry, LIBRARY_SOURCES } from '../../../src/editor/libraryModel.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const text = (rel: string): string => readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// ---- A world of our own: a building of two rooms 100 m out, turned a quarter, and the tool over the real editing. ----

const lamp = (x: number, y: number, z: number) => ({ type: 2, color: [1, 0.9, 0.7], position: [x, y, z], direction: [0, 0, 1], attenuation: [1, 0.2, 0.01] });
const CELLS = [
  { index: 0, name: 'r0', lights: [] },
  { index: 1, name: 'hall', portals: [{ target: 2 }], lights: [{ type: 0, color: [0.1, 0.1, 0.1], position: [0, 0, 0], direction: [0, 0, 1], attenuation: [1, 0, 0] }, { type: 1, color: [1, 1, 1], position: [0, 6, 0], direction: [0, -1, 0], attenuation: [1, 0, 0] }, lamp(1, 2.5, 1), lamp(-2, 2.5, 3)] },
  { index: 2, name: 'back', portals: [{ target: 1 }], lights: [lamp(0, 2, -6)] },
];
const MATRIX = new THREE.Matrix4().compose(new THREE.Vector3(100, 0, -50), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), new THREE.Vector3(1, 1, 1));
const building = (copy: string | null): LightsBuilding => ({ ref: CELLS, model: 'ours_house', copy, template: 'place/house-1', cell: 1, matrix: MATRIX, inverse: MATRIX.clone().invert(), cells: CELLS });

interface World {
  h: ReturnType<typeof makeHarness>;
  t: EditorLights;
  host: LightsHost;
  lives: LiveLight[];
  said: string[];
  shape: PoolShape;
  inRoom: boolean;
  read(kind: 'lights' | 'lightsAll'): LightRow[];
}
// Another building whose rooms share the first's indices and names (another copy's list of cells): what the room rule answers
// for a point standing in it.
const OTHER: LightsBuilding = { ...building('place/house-2'), ref: CELLS.slice() };
const make = (o: { copy?: string | null; kind?: 'ground' | 'space' | 'copies'; shape?: PoolShape; rows?: PlacementRow[]; under?: () => string | null; roomOf?: (x: number, y: number, z: number) => number | 'other' | null } = {}): World => {
  const h = makeHarness({ world: 'tatooine', rows: o.rows });
  const lives: LiveLight[] = [];
  const said: string[] = [];
  const B = building(o.copy === undefined ? 'place/house-1' : o.copy);
  const w = { h, lives, said, shape: o.shape ?? DEFAULT_POOL, inRoom: true } as World;
  const files = h.files as Record<string, string | null | undefined>;
  w.read = (kind) => {
    const t = files[kind];
    return t ? readLightsFile(t, kind === 'lights' ? 'tatooine' : null, 'ground').rows : [];
  };
  let version = 0;
  let seen = '';
  const rowsRec = { world: [] as LightRow[], all: [] as LightRow[] };
  const host: LightsHost = {
    edits: h.e,
    worldKind: () => o.kind ?? 'ground',
    rows: () => {
      const key = `${files.lights ?? ''}\u0000${files.lightsAll ?? ''}`;
      if (key !== seen) {
        seen = key;
        rowsRec.world = w.read('lights');
        rowsRec.all = w.read('lightsAll');
        version++;
      }
      return rowsRec;
    },
    cameraBuilding: () => (w.inRoom ? B : null),
    // The editor's room rule: the hall by default, else the test's own answer by place (a room of this building, a room of
    // another, or none).
    roomAt: (x, y, z) => {
      if (!w.inRoom) return null;
      if (!o.roomOf) return { building: B, cell: 1 };
      const c = o.roomOf(x, y, z);
      return c === null ? null : c === 'other' ? { building: OTHER, cell: 1 } : { building: B, cell: c };
    },
    toRaw: (x, z, out) => {
      out.x = -x;
      out.z = z;
    },
    toGame: (x, z, out) => {
      out.x = -x;
      out.z = z;
    },
    shape: () => w.shape,
    plan: () => {
      const r = host.rows();
      const e = new RoomLightEdits(r.world, r.all).forRoom(B.copy, B.model, CELLS);
      return planRoomLights(CELLS, 1, 0.18, w.shape, e);
    },
    planVersion: () => version,
    live: (l) => lives.push({ ...l }),
    attached: () => [],
    // The row of ours the aim rests on, as the game's host answers it: the file's own row read back, its layer, and its
    // model frame worked out from where it stands (`h.gameOf`, the harness's carry of the file into the game's frame).
    rowUnderAim: () => {
      const id = o.under?.() ?? null;
      const row = id ? h.rowOf(id) : undefined;
      const g = id ? h.gameOf(id) : null;
      if (!id || !row || !g) return null;
      const matrix = new THREE.Matrix4().compose(new THREE.Vector3(g.x, g.y, g.z), g.q, new THREE.Vector3(g.s[0], g.s[1], g.s[2]));
      return { id, layer: 'world', row: row as unknown as Record<string, unknown>, matrix };
    },
    look: (out) => {
      out.x = 0;
      out.z = -1;
    },
    eye: (out) => {
      out.x = 100;
      out.y = 3;
      out.z = -50;
    },
    grid: () => 0.5,
    say: (words) => said.push(words),
    refresh: () => {},
  };
  w.host = host;
  w.t = new EditorLights(host);
  return w;
};
const file = (w: World, k: 'lights' | 'lightsAll') => (w.h.files as Record<string, string | null | undefined>)[k] ?? null;

// ---- 1. A preset put down at each scope, undone and done again byte for byte. ----

{
  const w = make();
  const candle = presetOf('candle')!;
  const said = await w.t.putDown(candle, 101, 2, -48);
  const rows = w.read('lights');
  const r = rows[0];
  const local = new THREE.Vector3(101, 2 + 0.3, -48).applyMatrix4(MATRIX.clone().invert());
  ok(/written/.test(said) && rows.length === 1 && r.kind === 'light' && r.scope === 'copy' && r.copy === 'place/house-1' && r.model === 'ours_house' && r.cell === 1 && r.room === 'hall', `a candle put down in a room is one row of this copy, in the world's file (${said})`);
  ok(r.flicker?.shape === 'candle' && Math.abs(r.pos![0] - local.x) < 0.006 && Math.abs(r.pos![1] - local.y) < 0.006 && Math.abs(r.pos![2] - local.z) < 0.006, "it stands in the building's own frame, to the centimetre, its flicker the preset's");
  const t1 = file(w, 'lights');
  await w.h.e.undo(1);
  ok(file(w, 'lights') === null, 'one undo takes the file away with its last row');
  await w.h.e.redo(1);
  ok(file(w, 'lights') === t1, 'one redo writes the very text again');
  w.t.scope = 'all';
  await w.t.putDown(presetOf('ceiling-lamp')!, 100, 3, -50);
  const all = w.read('lightsAll');
  ok(all.length === 1 && all[0].id.startsWith('all-') && all[0].scope === 'all' && all[0].copy === undefined, "every copy everywhere: a row of the shared file, its id the shared file's");
  w.t.scope = 'world';
  await w.t.putDown(presetOf('desk-spot')!, 99, 1, -51);
  const ws = w.read('lights').find((x) => x.type === 'spot')!;
  ok(ws.scope === 'world' && ws.copy === undefined, 'every copy on this world: a row of the world\'s file naming no copy');
  ok(w.said.some((s) => /lights nothing until the Graphics page builds a spot slot/.test(s)), 'a spot put down with no spot slot built is said to light nothing until the Graphics page builds one');
  await w.h.e.undo(3);
  ok(file(w, 'lights') === null && file(w, 'lightsAll') === null, 'three undos leave both files gone');
  // A building with no copy key of its own: one copy's scope is every copy on this world's, said.
  const n = make({ copy: null });
  await n.t.putDown(candle, 101, 2, -48);
  ok(n.read('lights')[0].scope === 'world' && n.said.some((s) => /no copy key of its own/.test(s)), "a house put down in play has no copy key: its narrowest is every copy on this world, and said");
}

// ---- 2. A light picked, moved by the gizmo, raised, turned, nudged and duplicated. ----

{
  const w = make();
  await w.t.putDown(presetOf('ceiling-lamp')!, 100, 2.7, -50);
  const id = w.read('lights')[0].id;
  await w.t.arm();
  // The camera 12 m back along +Z of the world, looking at the lamp.
  const at = new THREE.Vector3(100, 3, -50);
  const view = w.h.look(new THREE.Vector3(100, 8, -38), at);
  const f = toolFrame();
  const marks = w.h.marks;
  const draw = { marks, radius: 0, ring() {} };
  const frame = (o: Partial<typeof f>) => {
    Object.assign(f, { apply: false, inverse: false, shift: false, lift: false, turn: false, dy: 0, dx: 0, dt: 1 / 60 }, o);
    w.t.step(f);
    w.t.overlay(draw, view);
  };
  const proj = (x: number, y: number, z: number) => {
    const v = new THREE.Vector3(x, y, z).applyMatrix4(new THREE.Matrix4().fromArray(Array.from(view.vp)));
    return { x: (v.x * 0.5 + 0.5) * 1600, y: (0.5 - v.y * 0.5) * 900 };
  };
  const p = proj(100, 3, -50);
  frame({ sx: p.x, sy: p.y });
  ok(marks.lightsOn && marks.lightCount === 5 && w.t.report().markers instanceof Array, `armed, every light of the building is marked (${marks.lightCount}: the game's parallel and three lamps over its two rooms, and ours)`);
  frame({ sx: p.x, sy: p.y, apply: true });
  frame({ sx: p.x, sy: p.y });
  ok(w.t.pickedKey === id && marks.gizmo !== null, `a click on its marker picks it, and its gizmo shows (${w.t.pickedKey})`);
  // The ground square dragged 2 m along the world's X.
  const L = marks.gizmo!;
  const sq = { x: (L.square[0] + L.square[2] + L.square[4] + L.square[6]) / 4, y: (L.square[1] + L.square[3] + L.square[5] + L.square[7]) / 4 };
  frame({ sx: sq.x, sy: sq.y });
  frame({ sx: sq.x, sy: sq.y, apply: true });
  const to = proj(102, 3, -50);
  const dx = to.x - p.x;
  for (let i = 1; i <= 10; i++) frame({ sx: sq.x + (dx * i) / 10, sy: sq.y, apply: true });
  ok(w.lives.some((l) => l.key === id), "while it is dragged the pool is handed the light where the hand has it");
  const before = w.read('lights')[0].pos!.slice();
  frame({ sx: sq.x + dx, sy: sq.y });
  await w.h.settle();
  const after = w.read('lights')[0];
  const moved = new THREE.Vector3(after.pos![0], after.pos![1], after.pos![2]).applyMatrix4(MATRIX).sub(new THREE.Vector3(before[0], before[1], before[2]).applyMatrix4(MATRIX));
  ok(Math.abs(moved.x - 2) < 0.3 && Math.abs(moved.y) < 0.02 && Math.abs(moved.z) < 0.3 && w.h.e.history.actions.length === 2, `let go, it is written moved about 2 m along the world's X in one write (${moved.x.toFixed(2)}, ${moved.y.toFixed(2)}, ${moved.z.toFixed(2)})`);
  ok(w.lives.at(-1)?.key === '', "and the pool lets the hand's light go");
  // F held with the mouse moving: raised, written once on letting go.
  const y0 = w.read('lights')[0].pos![1];
  for (let i = 0; i < 20; i++) frame({ sx: sq.x + dx, sy: sq.y, lift: true, dy: -6 });
  ok(w.t.holdsMouse(true, false), 'F held on a picked light of ours takes the mouse (the camera holds still)');
  frame({ sx: sq.x + dx, sy: sq.y });
  await w.h.settle();
  const y1 = w.read('lights')[0].pos![1];
  ok(y1 > y0 + 0.05 && w.h.e.history.actions.length === 3, `F held and let go: raised ${(y1 - y0).toFixed(2)} m in one write`);
  // R held: a spot turned (a type changed first, one write of its own).
  await w.t.setPicked({ type: 'spot' });
  const spot = w.read('lights')[0];
  ok(spot.type === 'spot' && spot.reach === presetOf('ceiling-lamp')!.spec.reach && spot.cone === undefined, "a type changed to a spot keeps its reach and takes the default cone (written absent)");
  // R alone turns about up, which leaves a spot shining straight down as it was: Shift+R tips it.
  for (let i = 0; i < 20; i++) frame({ sx: sq.x + dx, sy: sq.y, turn: true, dy: 8 });
  frame({ sx: sq.x + dx, sy: sq.y });
  await w.h.settle();
  ok(w.read('lights')[0].q === undefined, 'R held on a spot shining straight down turns it about up: still straight down, nothing written but the same way');
  for (let i = 0; i < 20; i++) frame({ sx: sq.x + dx, sy: sq.y, turn: true, shift: true, dy: 8 });
  frame({ sx: sq.x + dx, sy: sq.y });
  await w.h.settle();
  const turned = w.read('lights')[0];
  ok(Array.isArray(turned.q) && turned.q.length === 4, `Shift+R held and let go: the spot is tipped, its turn written (${turned.q?.join(', ')})`);
  // Its shine, in the world's frame: what R alone and the yaw ring turn about up.
  const shineOfRow = (r: LightRow): THREE.Vector3 => {
    const s: [number, number, number] = [0, -1, 0];
    shineOf(r.q, s);
    return new THREE.Vector3(s[0], s[1], s[2]).transformDirection(MATRIX);
  };
  const s0 = shineOfRow(turned);
  const heading = (v: THREE.Vector3): number => Math.atan2(v.x, v.z);
  const turnOf = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
  // R alone on the tipped spot, the mouse moving: its cone turns about up, its tip kept.
  const actionsBeforeR = w.h.e.history.actions.length;
  for (let i = 0; i < 20; i++) frame({ sx: sq.x + dx, sy: sq.y, turn: true, dy: 8 });
  frame({ sx: sq.x + dx, sy: sq.y });
  await w.h.settle();
  const s1 = shineOfRow(w.read('lights')[0]);
  ok(w.h.e.history.actions.length === actionsBeforeR + 1 && turnOf(heading(s0), heading(s1)) > 0.05 && Math.abs(s1.y - s0.y) < 1e-3, `R held on a tipped spot turns its cone about up in one write: its heading by ${turnOf(heading(s0), heading(s1)).toFixed(3)} rad, its tip kept (${s0.y.toFixed(4)}, ${s1.y.toFixed(4)})`);
  // The gizmo's yaw ring (R held, shown), grabbed and dragged a quarter round: one write, the cone turned about up.
  frame({ sx: sq.x + dx, sy: sq.y, turn: true });
  const ring = marks.gizmo!.rings[0];
  const rp = (j: number) => ({ x: ring[j * 2], y: ring[j * 2 + 1] });
  const a0 = rp(0);
  frame({ sx: a0.x, sy: a0.y });
  frame({ sx: a0.x, sy: a0.y, turn: true });
  frame({ sx: a0.x, sy: a0.y, turn: true, apply: true });
  const grabbed = (w.t as unknown as { dragging: boolean }).dragging;
  for (let j = 1; j <= 8; j++) frame({ sx: rp(j).x, sy: rp(j).y, turn: true, apply: true });
  frame({ sx: rp(8).x, sy: rp(8).y, turn: true });
  frame({ sx: rp(8).x, sy: rp(8).y });
  await w.h.settle();
  const s2 = shineOfRow(w.read('lights')[0]);
  ok(grabbed && w.h.e.history.actions.length === actionsBeforeR + 2 && turnOf(heading(s1), heading(s2)) > 0.3 && Math.abs(s2.y - s1.y) < 1e-3, `the yaw ring grabbed and dragged a quarter round turns the cone about up in one write (${turnOf(heading(s1), heading(s2)).toFixed(3)} rad, the tip kept)`);
  // The arrows: a nudge of a grid step along the camera's look.
  const n0 = turned.pos!.slice();
  w.t.nudge(0, 0.5, 0);
  await w.h.settle();
  const n1 = w.read('lights')[0].pos!;
  ok(Math.abs(n1[1] - n0[1] - 0.5) < 0.006, 'Page Up nudges it a grid step up, one write');
  // Ctrl+D: a copy beside it under an id of its own.
  const said = await w.t.duplicateNow();
  const both = w.read('lights');
  ok(/written/.test(said) && both.length === 2 && both[0].id !== both[1].id && w.t.pickedKey !== id, `Ctrl+D writes a copy under an id of its own and picks it (${both.map((r) => r.id).join(', ')})`);
  // Every one of those undone leaves the file as the first put down left it, then gone.
  const writes = w.h.e.history.actions.length;
  await w.h.e.undo(writes - 1);
  ok(w.read('lights').length === 1 && w.read('lights')[0].type === 'point', `${writes - 1} undos take every edit back to the lamp as it was put down`);
  await w.h.e.undo(1);
  ok(file(w, 'lights') === null, 'and one more takes the file away');
}

// ---- 2b. A light moved, nudged or duplicated is written in the room it lands in, never into another building's. ----

{
  // The hall west of x 101, the back room from there to x 103, another building's room past it.
  const w = make({ roomOf: (x) => (x < 101 ? 1 : x < 103 ? 2 : 'other') });
  await w.t.putDown(presetOf('candle')!, 100.5, 2, -48);
  const r0 = w.read('lights')[0];
  ok(r0.cell === 1 && r0.room === 'hall', `put down west of the doorway, the candle is the hall's (${r0.room})`);
  w.t.pickKey(r0.id);
  w.t.nudge(1, 0, 0);
  await w.h.settle();
  const r1 = w.read('lights')[0];
  ok(r1.cell === 2 && r1.room === 'back' && w.h.e.history.actions.length === 2, `nudged a metre east through the doorway, it is written the back room's in one write (${r1.room})`);
  const said = await w.t.duplicateNow();
  const dup = w.read('lights').find((r) => r.id !== r0.id)!;
  ok(/written/.test(said) && dup.cell === 2 && dup.room === 'back', `duplicated beside it, the copy is the room it lands in's (${dup.room})`);
  w.t.pickKey(r0.id);
  const before = file(w, 'lights');
  const actions = w.h.e.history.actions.length;
  w.t.nudge(2, 0, 0);
  await w.h.settle();
  ok(file(w, 'lights') === before && w.h.e.history.actions.length === actions && w.said.some((s) => /stays in that building/.test(s)), "nudged into another building's room, nothing is written, and the tool says why");
  // A place typed on the Selected tab (the building's own frame) back west of the doorway: the hall's again.
  const hall = new THREE.Vector3(100.2, 2.3, -48).applyMatrix4(MATRIX.clone().invert());
  await w.t.setPicked({ pos: `${hall.x} ${hall.y} ${hall.z}` });
  const r2 = w.read('lights').find((r) => r.id === r0.id)!;
  ok(r2.cell === 1 && r2.room === 'hall', `a place typed in west of the doorway goes through the same rule: the hall's again (${r2.room})`);
  w.t.pickKey(r0.id);
  w.t.nudge(0.6, 0, 0);
  await w.h.settle();
  const r3 = w.read('lights').find((r) => r.id === r0.id)!;
  ok(r3.cell === 1 && r3.room === 'hall', `nudged short of the doorway, it stays the hall's (${r3.room})`);
}

// ---- 3. One of the game's own lights edited at the tool's scope. ----

{
  const w = make({ shape: roomPoolShape(0, 1) });
  w.t.pickKey('g:1:2');
  ok(w.t.pickedKey === 'g:1:2' && w.t.pickedSrc === 'game', "one of the game's own lamps is picked by its key");
  await w.t.setPicked({ scale: 2 });
  await w.t.setPicked({ shadow: true });
  const e = w.read('lights');
  ok(e.length === 1 && e[0].kind === 'edit' && e[0].of === 2 && e[0].scale === 2 && e[0].shadow === true && e[0].copy === 'place/house-1', 'scaled and a shadow asked for: one edit row of this copy, merged');
  const plan = w.host.plan()!;
  ok(plan.pointShadows.some((l) => l.key === 'g:1:2' && l.shadow), 'the plan casts it in the casting slot built');
  ok(/casting/.test(w.t.pickedLit() ?? ''), `the Selected tab says why it lights what it does (${w.t.pickedLit()})`);
  await w.t.deleteNow();
  ok(w.read('lights')[0].off === true && w.read('lights').length === 1, "Delete on one of the game's own switches it off in the same row");
  w.t.act('lights:clearEdit');
  await w.h.settle();
  await w.h.settle();
  ok(file(w, 'lights') === null, 'its edit cleared, the row is taken out and the file with it');
  // The room's fill.
  await w.t.setFill({ scale: 0.5, color: [0.2, 0.3, 0.4] });
  const f = w.read('lights')[0];
  ok(f.kind === 'fill' && f.scale === 0.5 && f.color?.[2] === 0.4 && f.cell === 1, "the room's fill set: one fill row");
  await w.t.setFill({ scale: null, color: null });
  ok(file(w, 'lights') === null, 'cleared, gone');
  // The marker reads the edits as the pool does, narrowest first and whole: switched off for every copy on this world, then
  // given a copy's own edit that leaves it lit.
  {
    const v = make();
    const warn = () => (v.t.report().markers as Array<{ key: string; warn: boolean }>).find((m) => m.key === 'g:1:2')!.warn;
    ok(warn() === false, "one of the game's own lamps with no edit is marked lit");
    v.t.scope = 'world';
    v.t.pickKey('g:1:2');
    await v.t.setPicked({ off: true });
    ok(warn() === true && !v.host.plan()!.points.some((l) => l.key === 'g:1:2'), 'switched off for every copy on this world: marked as lighting nothing, and the pool lights it not');
    v.t.scope = 'copy';
    v.t.pickKey('g:1:2');
    await v.t.setPicked({ scale: 1.5 });
    ok(warn() === false && v.host.plan()!.points.some((l) => l.key === 'g:1:2'), "a copy's own edit that leaves it lit decides for that copy, whole: marked lit, as the pool lights it");
  }
  // With no casting slot the shadow is kept and drawn without, and the tool says so.
  const z = make();
  await z.t.putDown({ ...presetOf('ceiling-lamp')!, spec: { ...presetOf('ceiling-lamp')!.spec, shadow: true } }, 100, 2.7, -50);
  ok(z.read('lights')[0].shadow === true, 'a light asking for a shadow keeps it in the file with no casting slot built');
  const sec = z.t.selectedSections().map((s) => s.note ?? '').join(' ');
  ok(/drawn without one/.test(sec), "the Selected tab says it is drawn without one, and why");
}

// ---- 3b. "Hang it on the row": a light put down over a row of ours hangs on that row, in the row's own frame. ----

{
  // A crate of ours 4 m east of the building, a metre up and turned a quarter about up.
  const crate = propRow('crate-1', -104, -48, { y: 1, q: [Math.SQRT1_2, 0, Math.SQRT1_2, 0] });
  let aim: string | null = 'crate-1';
  const w = make({ rows: [crate], under: () => aim });
  ok(w.t.report().hang === false, 'a light put down is a light of the room until the hang switch is on');
  w.t.act('lights:hang');
  ok(w.t.hang === true && w.t.report().hang === true, "the Tools tab's switch turns hanging on");
  const g = w.h.gameOf('crate-1')!;
  const before = w.h.files.world;
  const actions = w.h.e.history.actions.length;
  const said = await w.t.putDown(presetOf('candle')!, g.x + 0.5, g.y + 1, g.z);
  const row = w.h.rowOf('crate-1') as PlacementRow & { attach?: Array<{ light?: { type: string; flicker?: { shape: string } }; at?: [number, number, number] }> };
  const a = row.attach ?? [];
  ok(/written/.test(said) && a.length === 1 && a[0].light?.type === 'point' && a[0].light?.flicker?.shape === 'candle' && file(w, 'lights') === null && w.h.e.history.actions.length === actions + 1, `with the row of ours under the aim, the candle is hung on it in one write and no light of the room is made (${said})`);
  // Where it hangs, in the crate's own frame: a quarter turn about up sends the world's half metre east onto the crate's
  // own z, so a hand that wrote the world's offset would leave it on x; the lift and the metre up stay on y.
  const at = a[0].at ?? [0, 0, 0];
  const lift = LIGHTS_TOOL_TUNE.lift;
  ok(Math.abs(at[0]) < 0.002 && Math.abs(Math.abs(at[2]) - 0.5) < 0.002 && Math.abs(at[1] - (1 + lift)) < 0.002, `its place is in the crate's own frame (${at.join(', ')}): the half metre east on the crate's z, ${(1 + lift).toFixed(2)} m up`);
  const t1 = w.h.files.world;
  await w.h.e.undo(1);
  ok(w.h.files.world === before && w.h.rowOf('crate-1')!.attach === undefined, 'one undo takes the light off the crate, the file byte for byte');
  await w.h.e.redo(1);
  ok(w.h.files.world === t1, 'one redo hangs it again, the very text');
  // A second one hung beside it keeps the first.
  await w.t.putDown(presetOf('ceiling-lamp')!, g.x, g.y + 2, g.z);
  ok(((w.h.rowOf('crate-1') as typeof row).attach ?? []).length === 2, 'a second light hung on the same row keeps the first');
  // With nothing of ours under the aim, the switch on, a light put down is the room's again.
  aim = null;
  await w.t.putDown(presetOf('candle')!, 101, 2, -48);
  ok(w.read('lights').length === 1 && w.read('lights')[0].kind === 'light', 'with nothing of ours under the aim the light is a light of the room, the switch on or not');
}

// ---- 4. A type changed, a scope moved (two files, one action). ----

{
  const w = make();
  await w.t.putDown(presetOf('desk-spot')!, 100, 2, -50);
  await w.t.setPicked({ type: 'directional' });
  const d = w.read('lights')[0];
  ok(d.type === 'directional' && d.reach === undefined && d.cone === undefined, "a type changed to a directional leaves its reach and cone out (the reader refuses them)");
  await w.t.setPicked({ type: 'point' });
  ok(w.read('lights')[0].reach === DEFAULT_REACH, `back to a point it takes the reach a light naming none takes (${DEFAULT_REACH} m)`);
  const id = w.read('lights')[0].id;
  const t0 = file(w, 'lights');
  const actions = w.h.e.history.actions.length;
  await w.t.setPicked({ scope: 'all' });
  ok(file(w, 'lights') === null && w.read('lightsAll').length === 1 && w.read('lightsAll')[0].id.startsWith('all-') && w.h.e.history.actions.length === actions + 1, `moved to every copy everywhere: out of the world's file and into the shared one under an all- id, one action (${id} to ${w.read('lightsAll')[0]?.id})`);
  await w.h.e.undo(1);
  ok(file(w, 'lights') === t0 && file(w, 'lightsAll') === null, 'one undo puts both files back byte for byte');
  ok(w.t.pickedKey === '' || !w.t.pickKey(w.t.pickedKey), 'the light the undo took away is no longer picked');
  w.t.pickKey(id);
  const r = await w.t.setPicked({ brightness: 999 });
  ok(/brightness/.test(r) && w.read('lights')[0].brightness !== 999, `a field the reader refuses writes nothing and says why (${r})`);
}

// ---- 5. Outdoors a mark that lights nothing; the world of copies has no outdoors. ----

{
  const w = make();
  w.inRoom = false;
  const said = await w.t.putDown(presetOf('candle')!, 10, 0, 20);
  const r = w.read('lights')[0];
  ok(r.scope === 'outdoor' && r.pos![0] === -10 && r.pos![2] === 20 && r.model === undefined, `outdoors a light is an outdoor row in the file's raw frame (${r.pos?.join(', ')})`);
  ok(w.said.some((s) => /lights nothing until the Light and shadow pass/.test(s)), `and it is said to light nothing (${said})`);
  const c = make({ kind: 'copies' });
  c.inRoom = false;
  const no = await c.t.putDown(presetOf('candle')!, 10, 0, 20);
  ok(/no outdoors/.test(no) && file(c, 'lights') === null, "the world of copies has no outdoors: refused in words, nothing written");
}

// ---- Small rules. ----

ok(hexOfColour([1, 0.5, 0]) === '#ff8000' && hexOfColour([9, -1, 0.25]) === '#ff0040' && colourOfHex('#ff8000')?.[1] === 0.502 && colourOfHex('nope') === null, 'a colour to hex and back, a hot colour as white');
ok(turnToward({ x: 0, y: -1, z: 0 }) === null && JSON.stringify(turnToward({ x: 0, y: 1, z: 0 })) !== 'null', 'straight down is no turn; anything else is one');
ok(fileOfScope('all') === 'lightsAll' && fileOfScope('copy') === 'lights' && fileOfScope('outdoor') === 'lights', "every copy everywhere is the shared file's, every other scope the world's");
ok(LIGHT_PRESETS.length >= 4 && ['candle', 'ceiling-lamp', 'desk-spot', 'cantina-fill'].every((id) => !!presetOf(id)), 'the presets the design names are there');
{
  const e = lightEntries(LIGHT_PRESETS);
  ok(e.length === LIGHT_PRESETS.length && e.every((x) => isLightEntry(x) && x.s === 'lights') && (LIBRARY_SOURCES as readonly string[]).includes('lights'), "the library's Lights source is the presets");
}
{
  const t = lightsTool(make().t);
  ok(t.id === 'lights' && t.action === 'editorLights' && t.owns('apply') && !t.owns('inverse'), 'the tool is the list\'s `lights`, on its own key, owning the left button');
}

// ---- 6. The wiring only the game makes. ----

{
  const entry = text('src/editor/editorEntry.ts');
  ok(/this\.lights = new EditorLights\(this\.lightsHost\(\)\);\n    this\.lights\.rowOfKey = \(key\) => me\.rowOfPlacedKey\(key\);\n    this\.tools\.add\(lightsTool\(this\.lights\)\);/.test(entry), 'the editor makes the tool over its own host and puts it on the list');
  ok(/live: \(l\) => w\.roomLightLive\(l\),/.test(entry) && /shape: \(\) => w\.roomPoolShape,/.test(entry) && /plan: \(\) => w\.roomPlan,/.test(entry), "its host hands the hand's light to the world's pool as one record and reads the pool's shape and plan");
  ok(/roomAt: \(x, y, z\) => \{\n\s+const s = w\.streamer;\n\s+if \(!s\) return null;/.test(entry) && /x: b\.x,\n\s+z: b\.z,\n\s+radius: b\.radius,/.test(entry), "its host answers the room a point stands in and the building's reach, which a light moved is written by");
  ok(/const toolMouse = !oldHand && !!armedTool\?\.holdsMouse\?\.\(liftHeld, turnHeld\);/.test(entry) && /this\.toolDX = input\.mouseDX;/.test(entry) && /f\.turn = this\.toolTurn && !this\.ctrlHeld;/.test(entry), 'R held and the mouse across the screen reach the tool, and the camera holds still');
  ok(/toolKeys: \(\) => \{\n\s+const t = me\.tools\.armedTool;\n\s+if \(!t \|\| !t\.claimsKeys\?\.\(\) \|\| !t\.nudge \|\| !t\.duplicate\) return null;/.test(entry), 'the nudges and Ctrl+D go to a tool that claims them');
  ok(/if \(act\.startsWith\('lights:'\)\) this\.lights\.act\(act, value\);/.test(entry) && /\.\.\.this\.lightsSections\(tab\)/.test(entry), "the window's sections and their acts are the tool's");
  ok(/this\.lights\.worldGone\(\);/.test(entry) && /lightsLanded\(\): void \{\n\s+this\.lights\.stale\(\);/.test(entry), 'the world going and a landing reach the tool');
  ok(/if \(!base && isLightEntry\(e\)\) \{/.test(entry) && /\.\.\.lightEntries\(LIGHT_PRESETS\)/.test(entry), "the library's Lights arm the tool with the preset taken");
  const edit = text('src/editor/editorEdit.ts');
  ok(/const tool = this\.ed\.toolKeys\?\.\(\) \?\? null;\n\s+if \(tool\) \{/.test(edit) && /if \(tool\) tool\.duplicate\(\);\n\s+else if \(c === 'dup'\) void this\.duplicate\(\);/.test(edit), "the editing hands its nudges and Ctrl+D to a tool that claims them, before the selection's");
  const win = text('src/ui/editorWindow.ts');
  ok(/'sec:Lights': 'lights',/.test(win) && /'dials:The lights tool': 'lights',/.test(win), "the Tools tab shows the tool's sections only while it is armed");
  const input = text('src/core/input.ts');
  ok(/editorLights: \['Semicolon'\],/.test(input) && /'editorLights',\n\]\);/.test(input), 'its key is ; and it is the dev server\'s alone');
  const main = text('src/main.ts');
  ok(/this\.editor\?\.lightsLanded\(\);/.test(main) && /if \(ed\) editor = await ed\.lightsDebug\(rest\);/.test(main), 'the page tells the editor of a landing, and the console reaches the tool');
}

console.log(`\neditorLights: ${checks} checks passed`);
