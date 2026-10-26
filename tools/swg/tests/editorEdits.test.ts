// The world editor's editing class itself (`EditorEdits`, DESIGN.md §2.6, §5), driven as the game drives it round a
// stand-in editor whose every write goes through the endpoint's own batch on file texts (`editsHarness.ts`): a turn, a
// rise and a scale of several rows about the bottom middle of their boxes, each row's own turn kept under the new one
// (r * q), checked against three's own quaternions; the move, turn and scale snaps; End onto what stands under; duplicate
// and paste minting ids of their own, a world model pasted into another world keeping its own; the Selected tab's fields
// (a turn written in a planet's mirrored frame, a scale held to the reader's backstops, a building with rooms refused, a
// row's own fields set on every picked row); the room a row stands in worked out again where it moves to; a selection
// changed and acted on in one call turning about its own pivot; the handles a held key shows grabbed and dragged (a prop's
// own axis scaled, whatever it is turned to); a hold paused by Ctrl; a plain click's way back to Fly; and the class's own
// frame, steady and with a hold under way, making nothing (twelve processes at once, `editorAllocOwn.ts edits`).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { makeHarness, propRow, type Harness } from './editsHarness.ts';
import { EDITOR_TUNE } from '../../../src/editor/editorTune.ts';
import { H } from '../../../src/editor/gizmo.ts';
import { scaleHeld } from '../../../src/editor/editorEdit.ts';
import { copyRows } from '../../../src/editor/clipboard.ts';
import { fromGame, PLACEMENT_LIMITS, type PlacementRow } from '../../../src/story/placements.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) <= eps;
const UP = new THREE.Vector3(0, 1, 0);
const BOX = { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] };

/** A turn about up in the game's frame (three's sense), as a planet's file writes it (`[w, x, y, z]`, mirrored). */
function fileTurn(deg: number): [number, number, number, number] {
  const q = new THREE.Quaternion().setFromAxisAngle(UP, (deg * Math.PI) / 180);
  return fromGame({ x: 0, y: 0, z: 0, q: [q.x, q.y, q.z, q.w] }, { x: 0, z: 0 }, 'raw').q as [number, number, number, number];
}

/** The bottom middle of the boxes round some rows in the game's frame, worked out with three's own quaternions. */
function pivotOf(h: Harness, ids: string[]): THREE.Vector3 {
  const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
  const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const id of ids) {
    const g = h.gameOf(id)!;
    for (let i = 0; i < 8; i++) {
      const c = new THREE.Vector3(i & 1 ? BOX.max[0] : BOX.min[0], i & 2 ? BOX.max[1] : BOX.min[1], i & 4 ? BOX.max[2] : BOX.min[2]).multiply(new THREE.Vector3(...g.s)).applyQuaternion(g.q).add(new THREE.Vector3(g.x, g.y, g.z));
      lo.min(c);
      hi.max(c);
    }
  }
  return new THREE.Vector3((lo.x + hi.x) / 2, lo.y, (lo.z + hi.z) / 2);
}

/** Whether two turns are the same turn (either sign), to the turn's written digits. */
const sameTurn = (a: THREE.Quaternion, b: THREE.Quaternion) => Math.abs(Math.abs(a.dot(b)) - 1) < 1e-9 || a.angleTo(b) < 1e-5;

{
  // Several rows turned, raised and scaled about the bottom middle of their boxes, each its own turn kept under the new.
  const h = makeHarness({ rows: [propRow('a', 0, 0), propRow('b', 4, 0, { q: fileTurn(30) })] });
  h.e.snapOn = false;
  h.e.sel.pick(['a', 'b'], 'set');
  h.step();
  const start = h.files.world;
  const was = { a: h.gameOf('a')!, b: h.gameOf('b')! };
  const pv = pivotOf(h, ['a', 'b']);
  const r = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI / 2);
  const said = await h.e.stepHold('turn', 90);
  let good = true;
  for (const id of ['a', 'b'] as const) {
    const g = h.gameOf(id)!;
    const want = new THREE.Vector3(was[id].x, was[id].y, was[id].z).sub(pv).applyQuaternion(r).add(pv);
    const wantQ = r.clone().multiply(was[id].q);
    if (!near(g.x, want.x) || !near(g.y, want.y) || !near(g.z, want.z) || !sameTurn(g.q, wantQ)) good = false;
  }
  ok(/turn: 2 rows written/.test(said) && good, `two rows turned 90° about up go round the bottom middle of their boxes, each row's own turn composed under the new one in the world's frame (r * q), to three's own quaternions ("${said}")`);
  const afterTurn = h.files.world;
  const pv2 = pivotOf(h, ['a', 'b']);
  const before2 = { a: h.gameOf('a')!, b: h.gameOf('b')! };
  await h.e.stepHold('lift', 1.5);
  ok((['a', 'b'] as const).every((id) => near(h.gameOf(id)!.y, before2[id].y + 1.5) && near(h.gameOf(id)!.x, before2[id].x) && near(h.gameOf(id)!.z, before2[id].z)), 'raised 1.5 m: both rows rise 1.5 m and move no other way');
  const afterLift = h.files.world;
  const pv3 = pivotOf(h, ['a', 'b']);
  const before3 = { a: h.gameOf('a')!, b: h.gameOf('b')! };
  await h.e.stepHold('scale', 2);
  ok(
    (['a', 'b'] as const).every((id) => {
      const g = h.gameOf(id)!;
      const want = new THREE.Vector3(before3[id].x, before3[id].y, before3[id].z).sub(pv3).multiplyScalar(2).add(pv3);
      return near(g.x, want.x) && near(g.y, want.y) && near(g.z, want.z) && g.s.every((v) => v === 2) && sameTurn(g.q, before3[id].q);
    }) && pv2.distanceTo(pivotOf(h, ['a', 'b'])) > 0,
    'scaled 2: both rows stand twice as far from the pivot, each written at scale 2, its turn as it was',
  );
  const afterScale = h.files.world;
  ok((await h.e.undo(1)) === 'undone: scale' && h.files.world === afterLift, 'undone through the class, the scale puts the file back byte for byte');
  ok((await h.e.historyTo(0)).startsWith('undone') && h.files.world === start, 'the History jump back to nought puts the file back as it was before the turn, byte for byte');
  ok((await h.e.historyTo(3)).startsWith('done again') && h.files.world === afterScale, 'and forward three puts it as the scale left it, byte for byte');
  ok((await h.e.undo(2)) === 'undone: scale, lift' && h.files.world === afterTurn, 'back two, newest first, lands where the turn left it');
}

{
  // The same row moved twice, then jumped back over both and forward again one at a time, and the other way round: the
  // history keeps each action's own rows, so every jump after is the disk's.
  const h = makeHarness({ rows: [propRow('crate-1', 10, 5)] });
  h.e.snapOn = false;
  h.e.sel.pick(['crate-1'], 'set');
  const s0 = h.files.world;
  await h.e.step('move', -2, 0, 0);
  const s1 = h.files.world;
  await h.e.step('move', -2, 0, 0);
  const s2 = h.files.world;
  ok(h.rowOf('crate-1')!.x === 14, 'two moves of one crate (raw x 10 to 12 to 14)');
  ok((await h.e.historyTo(0)).startsWith('undone') && h.files.world === s0, 'jumped back over both at once: the file as it was');
  ok((await h.e.redo(1)).startsWith('done again') && h.files.world === s1 && h.rowOf('crate-1')!.x === 12, 'forward one: the first move again, byte for byte');
  ok((await h.e.redo(1)).startsWith('done again') && h.files.world === s2 && h.rowOf('crate-1')!.x === 14, 'forward one more: the second, which a history keeping the older row in its `before` refused');
  ok((await h.e.undo(1)).startsWith('undone') && (await h.e.undo(1)).startsWith('undone') && h.files.world === s0, 'back one at a time');
  ok((await h.e.historyTo(2)).startsWith('done again') && h.files.world === s2, 'forward over both at once');
  ok((await h.e.undo(1)).startsWith('undone') && h.files.world === s1 && (await h.e.undo(1)).startsWith('undone') && h.files.world === s0, 'and back one at a time from there');
}

{
  // The snaps: a move puts the pivot on the grid in the file's own frame, a turn about up on the angle step, a scale on its step.
  const h = makeHarness({ rows: [propRow('c', 0.1, 0.07)] });
  h.e.snapOn = true;
  h.e.grid = 0.25;
  h.e.angle = 15;
  h.e.sel.pick(['c'], 'set');
  await h.e.step('move', 0.3, 0, 0);
  const r = h.rowOf('c')!;
  ok(near(r.x / 0.25, Math.round(r.x / 0.25), 1e-9) && r.z === 0.07, `a move with snapping on puts the row on the 0.25 m grid along the axis it moved, in the file's own frame (raw x ${r.x}), and leaves the other (z ${r.z})`);
  await h.e.stepHold('turn', 20);
  const yaw = (2 * Math.atan2(h.gameOf('c')!.q.y, h.gameOf('c')!.q.w) * 180) / Math.PI;
  ok(near(yaw, 15, 1e-3), `a turn of 20° with the angle on 15° is written as 15° (${yaw.toFixed(4)})`);
  await h.e.stepHold('scale', 1.13);
  ok(h.rowOf('c')!.scale === 1.15, `a scale of 1.13 with the scale step 0.05 is written 1.15 (${JSON.stringify(h.rowOf('c')!.scale)})`);
}

{
  // End: each row dropped so its box's lowest point stands on what stands under it, the higher of that and the ground.
  const h = makeHarness({ rows: [propRow('d', 3, 0, { y: 5 })], floorAt: () => 2, terrainAt: () => 1 });
  h.e.sel.pick(['d'], 'set');
  const said = await h.e.ground(false);
  ok(/to the ground/.test(said) && h.rowOf('d')!.y === 2 && h.rowOf('d')!.ground === 1, `End stands the row on the floor under it (y ${h.rowOf('d')!.y}), the ground under it written beside (${h.rowOf('d')!.ground})`);
}

{
  // Duplicate and paste mint ids of their own, unique across both files; a world model keeps the world it came from.
  const h = makeHarness({ rows: [propRow('e', 0, 0), propRow('f', 2, 0)], story: [propRow('chair_1', 9, 9)] });
  h.e.sel.pick(['e', 'f'], 'set');
  const taken = new Set([...h.rowsOf('world').keys(), ...h.rowsOf('story').keys()]);
  await h.e.duplicate();
  const made = [...h.rowsOf('world').keys()].filter((id) => !taken.has(id));
  ok(made.length === 2 && made.every((id) => !taken.has(id)) && h.e.sel.ids.every((id) => made.includes(id)), `Ctrl+D makes two rows under ids of their own (${made.join(', ')}), none either file held, and picks them`);
  const copy = h.rowOf(made[0])!;
  const orig = h.rowOf(copy.x === 0 ? 'e' : 'f')!;
  ok(copy.x === orig.x && copy.z === orig.z && copy.thing === orig.thing && copy.id !== orig.id, 'in place, as what it copies but for its id and moment');
  // A world model copied on Naboo (its file names no `from`), pasted on Tatooine and on Naboo.
  const naboo = makeHarness({ world: 'naboo', rows: [{ id: 'tree_1', kind: 'prop', pack: 'world', model: 'naboo_tree_a', x: 0, y: 0, z: 0, q: [1, 0, 0, 0], at: 1_700_000_000_000 }] });
  naboo.e.sel.pick(['tree_1'], 'set');
  await naboo.e.copy(false);
  ok(naboo.e.clip?.rows[0].from === 'naboo', "copied on its own world, a world model's copy names the world it comes from");
  const tat = makeHarness({ world: 'tatooine', rows: [propRow('g', 0, 0)] });
  tat.e.clip = naboo.e.clip;
  await tat.e.paste(null, false);
  const pasted = [...tat.rowsOf('world').values()].find((r) => r.pack === 'world');
  ok(!!pasted && pasted.from === 'naboo' && pasted.model === 'naboo_tree_a' && pasted.id !== 'g', `pasted on Tatooine it is written from Naboo (${JSON.stringify({ id: pasted?.id, from: pasted?.from })}), not looked for in Tatooine's own pack`);
  await naboo.e.paste(null, false);
  const back = [...naboo.rowsOf('world').values()].filter((r) => r.id !== 'tree_1');
  ok(back.length === 1 && back[0].from === undefined && back[0].id !== 'tree_1', 'pasted on Naboo again it is written as a row of that world\'s own pack, no `from`');
  // A clipboard copied before rows named their world: the set's own world stands in.
  const old = copyRows([{ row: { id: 'x', kind: 'prop', pack: 'world', model: 'naboo_tree_a', x: 0, y: 0, z: 0, q: [1, 0, 0, 0] } as PlacementRow, x: 0, y: 0, z: 0, q: [0, 0, 0, 1] }], { x: 0, y: 0, z: 0 }, 'naboo');
  delete old.rows[0].from;
  tat.e.clip = old;
  await tat.e.paste(null, false);
  ok([...tat.rowsOf('world').values()].filter((r) => r.pack === 'world').every((r) => r.from === 'naboo'), "and a clipboard whose rows name no world takes the set's own");
}

{
  // The Selected tab: a turn written in a planet's mirrored frame, a scale held to the backstops, a building's refused,
  // and a row's own fields set on every picked row alike.
  const h = makeHarness({ rows: [propRow('p', 0, 0), propRow('q', 1, 0), { id: 'house', kind: 'building', pack: 'gallery', model: 'house_a', x: 50, y: 0, z: 0, q: [1, 0, 0, 0], at: 1_700_000_000_000 }], rooms: ['house'] });
  h.e.sel.pick(['p'], 'set');
  await h.e.setPlace({ yaw: 90 });
  const want = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0, 'YXZ'));
  ok(sameTurn(h.gameOf('p')!.q, want), "the Selected tab's yaw of 90 reads back, through the planet's mirror, as three's own turn of 90° about up");
  const said = await h.e.setPlace({ scale: 5000 });
  ok(h.rowOf('p')!.scale === PLACEMENT_LIMITS.scaleMax && /held to the reader/.test(said), `a scale of 5000 is written as the reader's most, 1000, and says so ("${said}")`);
  await h.e.setPlace({ scale: [2, 1, 1] });
  ok(JSON.stringify(h.rowOf('p')!.scale) === '[2,1,1]', 'a scale along one axis is written as three');
  await h.e.setPlace({ scale: 1 });
  ok(h.rowOf('p')!.scale === undefined, 'and a scale of 1 as none');
  h.e.sel.pick(['house'], 'set');
  const no = await h.e.setPlace({ scale: 2 });
  ok(/building with rooms/.test(no) && h.rowOf('house')!.scale === undefined, `a building with rooms takes no scale from the Selected tab ("${no}")`);
  h.e.sel.pick(['p', 'q'], 'set');
  await h.e.setField({ note: 'TEST: picked', solid: false });
  ok(h.rowOf('p')!.note === 'TEST: picked' && h.rowOf('q')!.note === 'TEST: picked' && h.rowOf('p')!.solid === false && h.rowOf('q')!.solid === false, 'a row\'s own fields are set on every picked row alike, in one action');
  ok(h.e.history.actions[h.e.history.actions.length - 1].changes.length === 2, 'one action of two rows');
  ok(scaleHeld(0) === PLACEMENT_LIMITS.scaleMin && scaleHeld(1e9) === PLACEMENT_LIMITS.scaleMax && scaleHeld(Number.NaN) === 1 && scaleHeld(2.5) === 2.5, "`scaleHeld` keeps a scale inside the reader's backstops");
}

{
  // A scale that would pass the reader's least is held there, and the row is written, never refused.
  const h = makeHarness({ rows: [propRow('s', 0, 0)] });
  h.e.snapOn = false;
  h.e.sel.pick(['s'], 'set');
  const one = await h.e.stepHold('scale', 0.0001);
  ok(/written/.test(one) && h.rowOf('s')!.scale === PLACEMENT_LIMITS.scaleMin, `a scale of 0.0001 is written as the reader's least, 0.001 ("${one}")`);
  const two = await h.e.stepHold('scale', 0.5);
  ok(!/refused/.test(two) && h.rowOf('s')!.scale === PLACEMENT_LIMITS.scaleMin, `and shrunk again it stays there, never cut to nought and refused as a field the endpoint does not write ("${two}")`);
}

{
  // The room a row stands in worked out again where it moves to: into a room, out of it, a paste into one, a duplicate
  // offset into one; and what stood in a building with rooms moved with it keeps its room.
  const room = (x: number) => x < -50;
  const h = makeHarness({ rows: [propRow('m', 0, 0), { id: 'house', kind: 'building', pack: 'gallery', model: 'house_a', x: 200, y: 0, z: 0, q: [1, 0, 0, 0], at: 1_700_000_000_000 }, propRow('in_house', 200, 1, { inside: true })], rooms: ['house'], roomAt: (x) => room(x), terrainAt: () => 3 });
  h.e.snapOn = false;
  h.e.sel.pick(['m'], 'set');
  await h.e.step('move', -60, 0, 0);
  ok(h.rowOf('m')!.inside === true && h.rowOf('m')!.ground === undefined, 'moved into a room it is written as standing in one, with no ground');
  await h.e.step('move', 60, 0, 0);
  ok(h.rowOf('m')!.inside === undefined && h.rowOf('m')!.ground === 3, 'moved back out it stands in none, and the ground under it is written');
  EDITOR_TUNE.dupOffset = 100;
  await h.e.duplicate();
  EDITOR_TUNE.dupOffset = 0;
  const dup = h.rowOf(h.e.sel.ids[0])!;
  ok(dup.id !== 'm' && dup.x === 100 && dup.inside === true && dup.ground === undefined, 'a duplicate offset into a room stands in it');
  h.e.sel.pick(['m'], 'set');
  await h.e.copy(false);
  (h.host as unknown as { hit: () => { x: number; y: number; z: number } }).hit = () => ({ x: -80, y: 0, z: 0 });
  await h.e.paste(null, false);
  const p = h.rowOf(h.e.sel.ids[0])!;
  ok(p.id !== 'm' && p.inside === true && p.ground === undefined, 'a paste into a room stands in it');
  h.e.sel.pick(['house', 'in_house'], 'set');
  await h.e.step('move', 0, 0, 40);
  ok(h.rowOf('in_house')!.inside === true, "a building with rooms moved with what stands in its rooms: that keeps its room (the building's rooms stand there only once written)");
}

{
  // A selection changed and acted on in one call, with no frame between: the new selection's own pivot.
  const h = makeHarness({ rows: [propRow('a', 0, 0), propRow('b', 40, 0)] });
  h.e.snapOn = false;
  h.e.sel.pick(['b'], 'set');
  h.step();
  h.e.sel.pick(['a'], 'set');
  await h.e.stepHold('turn', 90);
  ok(h.rowOf('a')!.x === 0 && h.rowOf('a')!.z === 0 && h.rowOf('b')!.x === 40, `picked and turned in one call it turns about its own origin and stays where it was (raw ${h.rowOf('a')!.x}, ${h.rowOf('a')!.z})`);
}

{
  // The handles a held key shows: a press on one gives the hold up and grabs it. C held on a prop turned 90°: the box of
  // its X axis lies along the prop's own X, and dragged out half as far again scales the prop along its own X by 1.5.
  const h = makeHarness({ rows: [propRow('a', 0, 0, { q: fileTurn(90) })], point: true });
  h.e.snapOn = false;
  h.look(new THREE.Vector3(10, 8, 20), new THREE.Vector3(0, 0, 0));
  h.e.sel.pick(['a'], 'set');
  h.input.heldActs.add('editorScale');
  h.pointer.x = 800;
  h.pointer.y = 450;
  h.step();
  const L = (h.e as unknown as { layout: { ends: Float64Array; dirs: Float64Array; px: number; py: number; hot: number; shown: boolean[] } }).layout;
  const own = new THREE.Vector3(1, 0, 0).applyQuaternion(h.gameOf('a')!.q);
  const dir = new THREE.Vector3(L.dirs[H.sx * 3], L.dirs[H.sx * 3 + 1], L.dirs[H.sx * 3 + 2]);
  ok(L.shown[H.sx] && dir.distanceTo(own) < 1e-9, `with C held the X axis's scale box lies along the prop's own X (${dir.toArray().map((v) => v.toFixed(3)).join(', ')}), with the gizmo on the world's axes`);
  const ex = L.ends[H.sx * 2];
  const ey = L.ends[H.sx * 2 + 1];
  h.pointer.x = ex;
  h.pointer.y = ey;
  h.step();
  ok(L.hot === H.sx, 'the cursor on its end makes it the hot handle');
  h.pointer.pressed = 1;
  h.pointer.buttons = 1;
  h.step();
  const under = h.e.report().under as { label: string; via: string } | null;
  ok(!!under && under.via === 'drag' && under.label === 'scale', `a press on it gives the hold up and grabs the box (${JSON.stringify(under)})`);
  h.pointer.x = L.px + (ex - L.px) * 1.5;
  h.pointer.y = L.py + (ey - L.py) * 1.5;
  h.step();
  h.pointer.released = 1;
  h.pointer.buttons = 0;
  h.input.heldActs.delete('editorScale');
  h.step();
  await h.settle();
  ok(JSON.stringify(h.rowOf('a')!.scale) === '[1.5,1,1]', `dragged out half as far again the prop is scaled 1.5 along its own X alone (${JSON.stringify(h.rowOf('a')!.scale)})`);
  // F held: the up arrow grabbed and dragged up raises it, nothing else moving.
  h.input.heldActs.add('placeLift');
  h.pointer.x = 800;
  h.pointer.y = 450;
  h.step();
  const gx = (L.px + L.ends[H.up * 2]) / 2;
  const gy = (L.py + L.ends[H.up * 2 + 1]) / 2;
  h.pointer.x = gx;
  h.pointer.y = gy;
  h.step();
  h.pointer.pressed = 1;
  h.pointer.buttons = 1;
  h.step();
  ok((h.e.report().under as { via: string } | null)?.via === 'drag', 'with F held a press on the up arrow grabs it');
  h.pointer.y = gy - 40;
  h.step();
  h.pointer.released = 1;
  h.pointer.buttons = 0;
  h.input.heldActs.delete('placeLift');
  h.step();
  await h.settle();
  const r = h.rowOf('a')!;
  ok(r.y > 0.05 && r.x === 0 && r.z === 0, `and dragged up it raises the prop (y ${r.y}) and moves it no other way`);
  // R held: a press on the yaw ring grabs it.
  h.input.heldActs.add('placeTurn');
  h.step();
  h.pointer.x = (L as unknown as { rings: Float64Array[] }).rings[0][0];
  h.pointer.y = (L as unknown as { rings: Float64Array[] }).rings[0][1];
  h.step();
  h.pointer.pressed = 1;
  h.pointer.buttons = 1;
  h.step();
  ok((h.e.report().under as { via: string; label: string } | null)?.via === 'drag' && (h.e.report().under as { label: string }).label === 'turn', 'with R held a press on the yaw ring grabs it');
  h.e.cancel(false);
  h.input.heldActs.delete('placeTurn');
}

{
  // Ctrl held during a hold pauses it: the turn written is what the mouse moved before Ctrl, however long Ctrl is down.
  const run = async (ctrlFrames: number): Promise<THREE.Quaternion> => {
    const h = makeHarness({ rows: [propRow('a', 0, 0)] });
    h.e.snapOn = false;
    h.e.sel.pick(['a'], 'set');
    h.input.heldActs.add('placeTurn');
    for (let i = 0; i < 5; i++) {
      h.input.mouseDY = 10;
      h.step();
    }
    for (let i = 0; i < ctrlFrames; i++) {
      // The game's input still holds the last movement it read; Ctrl's frames must play none of it.
      h.input.mouseDY = 10;
      h.step({ ctrl: true });
    }
    h.input.mouseDY = 0;
    h.input.heldActs.delete('placeTurn');
    h.step();
    await h.settle();
    return h.gameOf('a')!.q;
  };
  const plain = await run(0);
  const held = await run(30);
  ok(plain.angleTo(new THREE.Quaternion()) > 1e-3 && sameTurn(plain, held), `thirty frames of Ctrl in the middle of a hold turn it no further (${((plain.angleTo(new THREE.Quaternion()) * 180) / Math.PI).toFixed(3)}° either way)`);
}

{
  // Shift+R tips and rolls a prop and never a building; a plain click goes back to Fly only with nothing picked.
  const h = makeHarness({ rows: [propRow('p', 0, 0), { id: 'house', kind: 'building', pack: 'gallery', model: 'house_a', x: 50, y: 0, z: 0, q: [1, 0, 0, 0], at: 1_700_000_000_000 }] });
  h.input.heldActs.add('placeTurn');
  h.input.heldActs.add('walk');
  h.e.sel.pick(['p'], 'set');
  h.step();
  ok((h.e.report().under as { label: string } | null)?.label === 'tip', 'Shift+R with no move key held tips a prop');
  h.e.cancel(false);
  h.e.sel.pick(['house'], 'set');
  h.step();
  ok((h.e.report().under as { label: string } | null)?.label === 'turn', 'and only turns a building about up');
  h.e.cancel(false);
  h.input.heldActs.clear();
  ok(!h.e.clickGoesToFly(), 'a plain click with something picked does not go to Fly (the frame lets go of it)');
  h.e.sel.clear();
  ok(h.e.clickGoesToFly(), 'with nothing picked it does');
}

{
  // A delete across a file's last row takes the file away, and the undo makes it again byte for byte.
  const h = makeHarness({ rows: [propRow('w', 0, 0)], story: [propRow('stool_1', 5, 5)] });
  const story = h.files.story;
  h.e.sel.pick(['stool_1'], 'set');
  await h.e.deleteSelected(true);
  ok(h.files.story === null, 'the story file, its last row taken out, is taken away');
  await h.e.undo(1);
  ok(h.files.story === story, 'undone, it is made again byte for byte, the row with its own moment');
}

{
  // The editing's own frame makes nothing: three rows picked and the cursor over the gizmo, then a hold of R under way,
  // each measured in twelve processes of their own at once, every one asserted (`editorAllocOwn.ts edits`).
  const file = fileURLToPath(new URL('./editorAllocOwn.ts', import.meta.url));
  const run = () =>
    new Promise<{ frames: number; made: number; scavenges: number; holdMade: number; holdScavenges: number; hold: boolean; picked: number; skipped?: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ['--expose-gc', '--allow-natives-syntax', file, 'edits'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('close', (code) => {
        const line = out.trim().split('\n').pop() ?? '';
        if (code !== 0) {
          const lines = err.trim().split('\n');
          reject(new Error(`the allocation child exited ${code}: ${lines.find((l) => /Error/.test(l))?.trim() ?? lines.pop() ?? line}`));
          return;
        }
        try {
          resolve(JSON.parse(line));
        } catch {
          reject(new Error(`the allocation child printed nothing that reads: ${line || '(nothing)'}`));
        }
      });
    });
  const all = await Promise.all(Array.from({ length: 12 }, run));
  const skipped = all.find((a) => a.skipped);
  if (skipped) console.log(`note the allocation measure was skipped: ${skipped.skipped}`);
  else
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      ok(a.picked === 3 && a.hold && a.scavenges === 0 && a.holdScavenges === 0 && a.made < 0.1 * a.frames && a.holdMade < 0.1 * a.frames, `process ${i + 1} of 12: the editing's frame with three rows picked makes ${Math.max(0, a.made)} bytes over ${a.frames} frames, and with a hold of R under way ${Math.max(0, a.holdMade)} (${a.scavenges + a.holdScavenges} collections)`);
    }
}

console.log(`\n${checks} checks passed`);
