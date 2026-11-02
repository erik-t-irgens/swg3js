// The world editor's hand on a building whose furniture is its own (the interior layout files' wave), on the real editing
// class (`EditorEdits`) round the edits harness: every way of moving, sizing, dropping, copying or taking out such a building
// carries the rows standing in its rooms with it, rigidly (`ownFurniture`, `carryPose`) -- a turn turns them about the
// building, a scale leaves them as they are (a building with rooms takes none), End takes them up or down with it, Ctrl+D
// and Ctrl+X take them too and a delete of the building takes them out in the same one action -- and the Selected tab's
// Furnished is one write each way, undone byte for byte, refused where turning it back on would stand every piece twice.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeHarness, propRow } from './editsHarness.ts';
import { placementKey, type PlacementRow } from '../../../src/story/placements.ts';
import { carryPose } from '../../../src/editor/editorEdit.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const T = 'object/building/tatooine/shared_cantina_tatooine.iff';
const AT = 1_700_000_000_000;
const yaw30: [number, number, number, number] = [Math.cos(Math.PI / 12), 0, Math.sin(Math.PI / 12), 0];
const building = (id: string, x: number, z: number, extra: Partial<PlacementRow> = {}): PlacementRow => ({ id, kind: 'building', pack: 'gallery', model: 'hall', template: T, x, y: 0, z, q: [1, 0, 0, 0], at: AT, ...extra });
const rows = (): PlacementRow[] => [
  building('own', 10, 10, { furnish: false }),
  building('filed', -40, 0),
  propRow('f-chair', 12, 11, { inside: true }),
  propRow('f-table', 8, 9, { inside: true, q: yaw30 }),
  { id: 'f-glow', kind: 'mark', x: 11, y: 2.5, z: 10, q: [1, 0, 0, 0], inside: true, attach: [{ fx: 'props:particles/glow.json' }], at: AT } as PlacementRow,
  propRow('crate-out', 30, 30),
];
const FURNITURE = ['f-chair', 'f-table', 'f-glow'];

/** A harness whose building `own` carries every `f-` row of the world file (the game's rule stood in). */
function harness(opts: { terrainAt?: (x: number, z: number) => number } = {}) {
  let h: ReturnType<typeof makeHarness> | null = null;
  h = makeHarness({
    rows: rows(),
    rooms: ['own', 'filed'],
    attachments: true,
    ...opts,
    hostedRows: (key: string) => (key === placementKey('own') ? [...h!.rowsOf('world').keys()].filter((id) => id.startsWith('f-')) : []),
  });
  return h;
}

// ---- What it carries. ----
{
  const h = harness();
  ok(h.e.carries('own') === 3 && h.e.carries('filed') === 0 && h.e.carries('f-chair') === 0, 'a building whose furniture is its own carries the rows in its rooms; a furnished one, and a row, carry nothing');
}

// ---- A turn turns them about the building, rigidly. ----
{
  const h = harness();
  const before = new Map(['own', ...FURNITURE].map((id) => [id, h.gameOf(id)!]));
  h.e.sel.pick(['own'], 'set');
  await h.e.stepHold('turn', 90);
  await h.settle();
  const b0 = before.get('own')!;
  const b1 = h.gameOf('own')!;
  const r = b1.q.clone().multiply(b0.q.clone().invert());
  let worst = 0;
  let worstTurn = 0;
  for (const id of FURNITURE) {
    const was = before.get(id)!;
    const now = h.gameOf(id)!;
    const want = new THREE.Vector3(was.x - b0.x, was.y - b0.y, was.z - b0.z).applyQuaternion(r).add(new THREE.Vector3(b1.x, b1.y, b1.z));
    worst = Math.max(worst, Math.abs(now.x - want.x), Math.abs(now.y - want.y), Math.abs(now.z - want.z));
    const wantQ = r.clone().multiply(was.q);
    worstTurn = Math.max(worstTurn, 1 - Math.abs(wantQ.dot(now.q)));
  }
  ok(Math.abs(b1.x - b0.x) < 1e-6 && Math.abs(b1.z - b0.z) < 1e-6 && 1 - Math.abs(r.w) > 0.2, 'the building turns about its own place');
  ok(worst < 2e-3 && worstTurn < 1e-5, `every row it carries turns about it with it, as one piece (worst ${worst.toFixed(4)} m, turn ${worstTurn.toExponential(1)})`);
  ok(h.rowOf('crate-out')!.x === 30, 'and nothing outside it moves');
}

// ---- A scale leaves them as they are (a building with rooms takes none). ----
{
  const h = harness();
  const text = h.files.world;
  h.e.sel.pick(['own'], 'set');
  const said = await h.e.stepHold('scale', 2);
  ok(h.files.world === text, `a building with rooms scaled leaves its furniture where it stands, unspread and unsized (${said})`);
}

// ---- End takes them up with it. ----
{
  const h = harness({ terrainAt: () => 3 });
  const before = new Map(['own', ...FURNITURE].map((id) => [id, h.gameOf(id)!]));
  h.e.sel.pick(['own'], 'set');
  await h.e.ground(false);
  await h.settle();
  const rise = h.gameOf('own')!.y - before.get('own')!.y;
  ok(Math.abs(rise - 3) < 1e-3, `the building sunk under the ground is raised onto it (${rise.toFixed(3)} m)`);
  const rose = FURNITURE.map((id) => h.gameOf(id)!.y - before.get(id)!.y);
  ok(rose.every((d) => Math.abs(d - 3) < 2e-3), `and every row it carries goes up with it, never cast down onto its old floor (${rose.map((d) => d.toFixed(3)).join(', ')})`);
  ok(FURNITURE.every((id) => h.rowOf(id)!.inside === true), 'each still in its room');
}

// ---- Ctrl+D takes them too; only the copy of what was picked is picked. ----
{
  const h = harness();
  const n = h.rowsOf('world').size;
  h.e.sel.pick(['own'], 'set');
  await h.e.duplicate();
  await h.settle();
  ok(h.rowsOf('world').size === n + 4 && h.e.sel.size === 1 && h.rowOf(h.e.sel.ids[0])!.kind === 'building' && h.rowOf(h.e.sel.ids[0])!.furnish === false, `a copy of a building whose furniture is its own copies its rows with it, and the copy of the building alone is picked (${h.rowsOf('world').size - n} rows)`);
}

// ---- Ctrl+X takes out exactly what it copied; a paste puts it all back. ----
{
  const h = harness();
  const text = h.files.world;
  h.e.sel.pick(['own'], 'set');
  await h.e.copy(true);
  await h.settle();
  ok(!['own', ...FURNITURE].some((id) => h.rowOf(id)) && !!h.rowOf('filed') && !!h.rowOf('crate-out'), 'a cut takes the building and its rows out together');
  const n = h.rowsOf('world').size;
  await h.e.paste(null, false);
  await h.settle();
  const pasted = [...h.rowsOf('world').values()].filter((r) => !['filed', 'crate-out'].includes(r.id));
  ok(h.rowsOf('world').size === n + 4 && pasted.filter((r) => r.kind === 'building').length === 1 && pasted.filter((r) => r.inside).length === 3, 'and a paste stands the building with its furniture, never an empty building whose rows are lost');
  await h.e.undo(1);
  await h.e.undo(1);
  ok(h.files.world === text, 'both undone, the file is as it was, byte for byte');
}

// ---- A delete of the building takes them out in the same one action. ----
{
  const h = harness();
  const text = h.files.world;
  await h.e.deleteRows(['own'], true);
  await h.settle();
  ok(!['own', ...FURNITURE].some((id) => h.rowOf(id)) && h.batches.length === 1, 'the building and every row it carries go in one write');
  await h.e.undo(1);
  ok(h.files.world === text, 'and one undo puts them all back, byte for byte');
}

// ---- The Selected tab's Furnished: one write each way, undone byte for byte, refused where it would stand pieces twice. ----
{
  const h = harness();
  const text = h.files.world;
  h.e.sel.pick(['filed'], 'set');
  await h.e.setField({ furnish: false });
  const empty = h.files.world;
  ok(h.rowOf('filed')!.furnish === false && h.batches.length === 1, 'turned off, a furnished building is written `furnish: false` in one write');
  await h.e.setField({ furnish: true });
  ok(h.rowOf('filed')!.furnish === undefined && h.batches.length === 2, 'turned on again, the field goes, in one write');
  await h.e.undo(1);
  ok(h.files.world === empty, 'one undo puts it back off, byte for byte');
  await h.e.undo(1);
  ok(h.files.world === text, 'and the next as it was, byte for byte');
  const batches = h.batches.length;
  h.e.sel.pick(['own'], 'set');
  const said = await h.e.setField({ furnish: true });
  ok(h.batches.length === batches && h.files.world === text && /every piece twice/.test(said), `turned on, a building whose furniture is its own rows is refused in words: the file's would stand beside them (“${said}”)`);
}

// ---- The carry's own arithmetic. ----
{
  const was = { x: 1, y: 0, z: 2, turn: { x: 0, y: 0, z: 0, w: 1 }, sx: 1, sy: 1, sz: 1 };
  const now = { x: 5, y: 3, z: -1, turn: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 }, sx: 1, sy: 1, sz: 1 };
  const base = { x: 2, y: 1, z: 2, turn: { x: Math.sin(0.2), y: 0, z: 0, w: Math.cos(0.2) }, sx: 0.5, sy: 0.5, sz: 0.5 };
  const out = { x: 0, y: 0, z: 0, turn: { x: 0, y: 0, z: 0, w: 1 }, sx: 1, sy: 1, sz: 1 };
  carryPose(was, now, base, out);
  const r = new THREE.Quaternion(now.turn.x, now.turn.y, now.turn.z, now.turn.w);
  const p = new THREE.Vector3(1, 1, 0).applyQuaternion(r).add(new THREE.Vector3(5, 3, -1));
  const q = r.clone().multiply(new THREE.Quaternion(base.turn.x, base.turn.y, base.turn.z, base.turn.w));
  ok(Math.abs(out.x - p.x) < 1e-12 && Math.abs(out.y - p.y) < 1e-12 && Math.abs(out.z - p.z) < 1e-12 && 1 - Math.abs(q.dot(new THREE.Quaternion(out.turn.x, out.turn.y, out.turn.z, out.turn.w))) < 1e-12 && out.sx === 0.5, "a carried row's place is its offset from the building turned by the building's turn since and laid from its new place, its turn composed in the world's frame, its size its own");
}

console.log(`\n${checks} checks passed`);
