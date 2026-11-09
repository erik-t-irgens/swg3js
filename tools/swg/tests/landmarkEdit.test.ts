// The world editor's Selected tab on the landmark fields (the horizon pass's wave 5b), on the real editing class (`EditorEdits`)
// round the edits harness: `landmark` and `drawDistance` each one write on the picked rows, undone byte for byte, a reach the
// reader would not take refused in words with nothing written, and a mark passed over.
//
// Run: node tools/swg/tests/landmarkEdit.test.ts
import assert from 'node:assert/strict';
import { makeHarness, propRow } from './editsHarness.ts';
import { type PlacementRow } from '../../../src/story/placements.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const AT = 1_700_000_000_000;
const rows = (): PlacementRow[] => [
  { id: 'tower', kind: 'building', pack: 'gallery', model: 'hall', x: 0, y: 0, z: 0, q: [1, 0, 0, 0], at: AT } as PlacementRow,
  propRow('beacon', 30, 30),
  { id: 'glow', kind: 'mark', x: 11, y: 2.5, z: 10, q: [1, 0, 0, 0], attach: [{ fx: 'props:particles/glow.json' }], at: AT } as PlacementRow,
];

{
  const h = makeHarness({ rows: rows(), rooms: ['tower'], attachments: true });
  const text = h.files.world;
  h.e.sel.pick(['tower', 'beacon'], 'set');
  await h.e.setField({ landmark: true });
  ok(h.rowOf('tower')!.landmark === true && h.rowOf('beacon')!.landmark === true && h.batches.length === 1, 'Seen from far off, ticked: `landmark: true` on every picked row, in one write');
  const marked = h.files.world;
  await h.e.setField({ drawDistance: 6000 });
  ok(h.rowOf('beacon')!.drawDistance === 6000 && h.batches.length === 2, 'a far copy kept to 6,000 m, in one write');
  const before = h.batches.length;
  const said = await h.e.setField({ drawDistance: 0.5 });
  ok(h.batches.length === before && h.rowOf('beacon')!.drawDistance === 6000 && /draw distance is metres/.test(said), `a reach the reader would not take is refused in words, nothing written (“${said}”)`);
  await h.e.setField({ drawDistance: null });
  ok(h.rowOf('beacon')!.drawDistance === undefined, 'emptied, the field goes');
  await h.e.setField({ landmark: false });
  ok(h.rowOf('tower')!.landmark === undefined && h.rowOf('beacon')!.landmark === undefined, 'unticked, `landmark` goes (only `true` is ever written)');
  await h.e.undo(1);
  await h.e.undo(1);
  await h.e.undo(1);
  ok(h.files.world === marked, 'three undos put it back to the landmark alone, byte for byte');
  await h.e.undo(1);
  ok(h.files.world === text, 'and the fourth as it was, byte for byte');
  h.e.sel.pick(['glow'], 'set');
  const n = h.batches.length;
  const passed = await h.e.setField({ landmark: true, drawDistance: 4000 });
  ok(h.batches.length === n && h.rowOf('glow')!.landmark === undefined && /mark takes/.test(passed), 'a mark takes neither (it has no model to be seen), and says so');
}

// The review round: a row in a building's rooms has no far copy (the landmark index leaves every contained thing out), so a
// field that would make one is passed over and said; one it already carries can still be taken off.
{
  const h = makeHarness({ rows: [...rows(), propRow('chair', 2, 2, { inside: true }), propRow('stool', 3, 3, { inside: true, drawDistance: 900 })], rooms: ['tower'], attachments: true });
  h.e.sel.pick(['chair'], 'set');
  const n = h.batches.length;
  const said = await h.e.setField({ landmark: true, drawDistance: 4000 });
  ok(h.batches.length === n && h.rowOf('chair')!.landmark === undefined && h.rowOf('chair')!.drawDistance === undefined && /building's rooms has no far copy/.test(said), `a row inside takes neither, nothing written, and says why ("${said}")`);
  h.e.sel.pick(['chair', 'beacon'], 'set');
  await h.e.setField({ landmark: true });
  ok(h.rowOf('beacon')!.landmark === true && h.rowOf('chair')!.landmark === undefined && h.batches.length === n + 1, 'picked with a row out in the open, only that one is written');
  h.e.sel.pick(['stool'], 'set');
  await h.e.setField({ drawDistance: null });
  ok(h.rowOf('stool')!.drawDistance === undefined, 'a reach a row inside already carried can still be taken off');
}

console.log(`\nlandmarkEdit: ${checks} checks passed`);
