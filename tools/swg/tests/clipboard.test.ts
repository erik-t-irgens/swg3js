// The world editor's clipboard (DESIGN.md §2.6): rows copied relative to the selection's pivot in the game's frame, less
// their id, their moment and their ground; written out as JSON and read back only when it is the editor's and every row
// reads as a row does; a paste takes the document's own text first and the set in memory otherwise; stood at the aim's hit
// each row keeps its own turn, or with Shift the whole set is turned about the pivot to face the camera.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CLIP_KIND, clipText, copyRows, pasteAt, pasteSource, pastedRow, readClip, type PlacedRow } from '../../../src/editor/clipboard.ts';
import type { PlacementRow } from '../../../src/story/placements.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const q = (yaw: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
const placed = (row: PlacementRow, x: number, y: number, z: number, yaw: number): PlacedRow => {
  const t = q(yaw);
  return { row, x, y, z, q: [t.x, t.y, t.z, t.w] };
};
const chair: PlacementRow = { id: 'chair-1', kind: 'prop', pack: 'props', thing: 'chair', x: 1, y: 2, z: 3, q: [1, 0, 0, 0], at: 1_700_000_000_000, ground: 1.9, scale: 2, name: 'TEST: the chair' };
const tree: PlacementRow = { id: 'tree-1', kind: 'prop', pack: 'world', model: 'tree_a', from: 'naboo', template: 'object/tangible/test/shared_tree.iff', x: 0, y: 0, z: 0, q: [1, 0, 0, 0], scale: [1, 1.5, 1] };
const pivot = { x: 100, y: 5, z: -50 };
const set = copyRows([placed(chair, 102, 6, -50, 0.5), placed(tree, 97, 5, -46, -1)], pivot, 'tatooine');

{
  const c = set.rows[0];
  ok(set.kind === CLIP_KIND && set.frame === 'pivot-game' && set.rows.length === 2, "a copy is the editor's own set, its places in the game's frame about the pivot");
  ok(!('id' in c) && !('at' in c) && !('ground' in c), 'a row copied keeps no id, no moment and no ground: a paste is a new row, judged where it stands');
  ok(c.x === 2 && c.y === 1 && c.z === 0 && c.scale === 2 && c.name === 'TEST: the chair' && c.thing === 'chair', 'and keeps its place about the pivot, its scale, its look and its words');
  ok(set.rows[1].from === 'naboo' && set.rows[1].template === 'object/tangible/test/shared_tree.iff' && Array.isArray(set.rows[1].scale), "another world's model keeps its world and its template, and a scale by axis");
  const t = q(0.5);
  ok(Math.abs(c.q[0] - t.w) < 1e-12 && Math.abs(c.q[2] - t.y) < 1e-12, "its turn is held as a row holds it ([w, x, y, z]), the game's");
}

{
  const text = clipText(set);
  const back = readClip(text);
  // Compared as JSON with its keys in order (the reader writes a row's fields in its own order) and -0 read as 0.
  const canon = (r: object) => JSON.stringify(Object.fromEntries(Object.entries(r).sort(([a], [b]) => (a < b ? -1 : 1))));
  const same = back !== null && back.rows.length === set.rows.length && back.rows.every((r, i) => canon(r) === canon(set.rows[i]));
  ok(same, 'the JSON reads back as the set it was written from');
  ok(readClip('a chair') === null && readClip('{"kind":"other","version":1,"frame":"pivot-game","rows":[{}]}') === null && readClip('[]') === null, "any other text is not the editor's clipboard");
  const bad = JSON.parse(text);
  bad.rows[0].secret = 1;
  ok(readClip(JSON.stringify(bad)) === null, 'a row carrying a field a row does not have refuses the whole set');
  const bad2 = JSON.parse(text);
  delete bad2.rows[1].model;
  ok(readClip(JSON.stringify(bad2)) === null, 'and so does a row that would not read as a row (a world row naming no model)');
  ok(pasteSource(text, null) !== null && pasteSource('words', set) === set && pasteSource(null, null) === null, "a paste takes the document's own text when it is the editor's, and the set in memory otherwise");
}

{
  const at = { x: 10, y: 1, z: 20 };
  const p = pasteAt(set, at);
  ok(p[0].x === 12 && p[0].y === 2 && p[0].z === 20 && p[1].x === 7 && p[1].z === 24, "stood at the aim's hit, each row at its place about it");
  const t = q(0.5);
  ok(Math.abs(p[0].q[1] - t.y) < 1e-12 && Math.abs(p[0].q[3] - t.w) < 1e-12, 'each keeping its own turn');
  const turn = Math.PI / 2;
  const pt = pasteAt(set, at, turn);
  const r = q(turn);
  for (let i = 0; i < 2; i++) {
    const off = new THREE.Vector3(set.rows[i].x, set.rows[i].y, set.rows[i].z).applyQuaternion(r);
    const own = new THREE.Quaternion(set.rows[i].q[1], set.rows[i].q[2], set.rows[i].q[3], set.rows[i].q[0]);
    const want = r.clone().multiply(own);
    const got = new THREE.Quaternion(pt[i].q[0], pt[i].q[1], pt[i].q[2], pt[i].q[3]);
    ok(Math.abs(pt[i].x - (at.x + off.x)) < 1e-12 && Math.abs(pt[i].z - (at.z + off.z)) < 1e-12 && 1 - Math.abs(want.dot(got)) < 1e-14, `with Shift the whole set is turned about the pivot as one piece (row ${i + 1}: its place turned, its own turn r * q)`);
  }
}

{
  // A world model names the world it comes from: given it on the copy, written absent where it is pasted into that world.
  const tree = { id: 'tree_1', kind: 'prop', pack: 'world', model: 'naboo_tree_a', x: 0, y: 0, z: 0, q: [1, 0, 0, 0] } as PlacementRow;
  const crate = { id: 'crate_1', kind: 'prop', pack: 'props', thing: 'crate', x: 0, y: 0, z: 0, q: [1, 0, 0, 0] } as PlacementRow;
  const far = { ...tree, id: 'tree_2', from: 'yavin4' } as PlacementRow;
  const set = copyRows([placed(tree, 0, 0, 0, 0), placed(crate, 1, 0, 0, 0), placed(far, 2, 0, 0, 0)], { x: 0, y: 0, z: 0 }, 'naboo');
  ok(set.rows[0].from === 'naboo' && set.rows[1].from === undefined && set.rows[2].from === 'yavin4', "copied on Naboo, a model of Naboo's own pack is given `from: naboo`, a props thing none, and one out of another world keeps its own");
  ok(readClip(clipText(set))?.rows[0].from === 'naboo', 'and the JSON carries it');
  ok(pastedRow(set.rows[0], set.world, 'tatooine').from === 'naboo' && pastedRow(set.rows[0], set.world, 'naboo').from === undefined, "pasted on Tatooine it stays Naboo's; pasted on Naboo it is written as Naboo's own, no `from`");
  ok(pastedRow(set.rows[2], set.world, 'yavin4').from === undefined && pastedRow(set.rows[1], set.world, 'tatooine').from === undefined, "one out of Yavin 4 pasted there is that world's own, and a props thing never names a world");
  const old = { ...set.rows[0] };
  delete old.from;
  ok(pastedRow(old, 'naboo', 'tatooine').from === 'naboo' && set.rows[0].from === 'naboo', "a clipboard copied before rows named their world takes the set's own, and `pastedRow` leaves the clipboard's row as it was");
}

console.log(`\n${checks} checks passed`);
