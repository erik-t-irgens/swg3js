// The world editor's undo and redo (DESIGN.md §2.6), run through the editing class itself (`EditorEdits`, round the
// stand-in editor of `editsHarness.ts`, whose every write is the endpoint's own batch on file texts): actions done,
// undone and done again put both files back byte for byte (the rows' own `at` kept, a made row back under its own id, a
// file taken away made again); the history keeps the rows the endpoint answered, so the next `was` is the disk's; a row
// edited by hand since is refused by its id and nothing is written; a jump back or forward several actions is one plan;
// an action bigger than one request goes as consecutive batches and comes to the same files; and the answered rows go to
// the last action of a plan to put each row alone.
import assert from 'node:assert/strict';
import { makeHarness, propRow } from './editsHarness.ts';
import { EDITOR_TUNE } from '../../../src/editor/editorTune.ts';
import { applyPlacementOp } from '../../../src/world/placementEdits.ts';
import { doEdits, redoEdits, takeAnswered, undoEdits, type EditAction } from '../../../src/editor/undo.ts';
import { copyRows } from '../../../src/editor/clipboard.ts';
import type { PlacementRow } from '../../../src/story/placements.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const chair = (id: string, x: number, at: number): PlacementRow => propRow(id, x, -x, { y: 1.5, at });

{
  // Both files as a world might hold them, every row with its own moment.
  const h = makeHarness({ rows: [chair('chair-1', 10, 1_700_000_000_001), chair('chair-2', 20, 1_700_000_000_002), chair('chair-3', 30, 1_700_000_000_003)], story: [chair('stool-1', 5, 1_700_000_000_004)] });
  h.e.snapOn = false;
  const start = { ...h.files };
  // Four actions across both files: a row moved, a row scaled, a row made (a paste), a row taken out of the story file.
  h.e.sel.pick(['chair-1'], 'set');
  ok(/move: 1 row written/.test(await h.e.step('move', -1.25, 0, 0)), 'a move through the class');
  h.e.sel.pick(['chair-2'], 'set');
  ok(/set the place/.test(await h.e.setPlace({ scale: 2 })), 'a scale through the Selected tab');
  h.e.sel.pick(['chair-3'], 'set');
  await h.e.copy(false);
  ok(/paste: 1 row written/.test(await h.e.paste(null, false)), 'a paste, a row made under an id of its own');
  const made = h.e.sel.ids[0];
  h.e.sel.pick(['stool-1'], 'set');
  ok(/delete: 1 row written/.test(await h.e.deleteSelected(true)), 'a delete out of the story file');
  const afterFour = { ...h.files };
  ok(h.files.story === null, 'the story file, its last row taken out, is taken away');
  const last = h.e.history.actions[1].changes[0].after!;
  ok(typeof last.at === 'number' && last.at === h.rowOf('chair-2')!.at, 'the history keeps the rows as the endpoint answered them, stamped');
  ok((await h.e.historyTo(0)).startsWith('undone') && h.files.world === start.world && h.files.story === start.story, 'back to nought puts both files back byte for byte: each row with its own at, the taken file made again, the made row gone');
  ok(!h.rowsOf('world').has(made), 'the made row is gone');
  ok((await h.e.historyTo(4)).startsWith('done again') && h.files.world === afterFour.world && h.files.story === afterFour.story, 'forward four puts them back as the actions left them, byte for byte, the made row under its own id');
  ok(h.rowsOf('world').has(made) && h.e.history.canUndo && !h.e.history.canRedo, 'and the history stands after them again');

  // A jump back two and forward again is one plan each way.
  const plan = h.e.history.editsTo(2);
  ok(plan.undo.map((x) => x.label).join() === 'delete,paste' && plan.redo.length === 0, 'a jump back two undoes the newest first');
  ok((await h.e.historyTo(2)).startsWith('undone') && h.e.history.at === 2 && h.rowsOf('story').has('stool-1') && !h.rowsOf('world').has(made), 'and lands where the second action left the files');
  ok((await h.e.historyTo(4)).startsWith('done again') && h.files.world === afterFour.world && h.files.story === afterFour.story, 'forward two lands where the fourth left them');

  // A row edited by hand since (another tab, or the file opened in an editor): refused by its id, nothing written.
  h.e.sel.pick(['chair-1'], 'set');
  await h.e.step('move', 0, 1, 0);
  const mine = h.rowOf('chair-1')!;
  const hand = applyPlacementOp({ op: 'put', layer: 'world', world: 'tatooine', row: { ...mine, x: 99 } }, { ...h.files }, { worlds: new Map([['tatooine', 'ground']]), now: 1_900_000_000_000 });
  for (const wr of hand.writes) h.files[wr.layer] = wr.text;
  const before = h.files.world;
  const at = h.e.history.at;
  const why = await h.e.undo(1);
  ok(/chair-1 has changed/.test(why) && h.files.world === before && h.e.history.at === at, `an undo over a row edited by hand since is refused by its id and writes nothing ("${why}")`);

  // A new action after an undo lets the undone ones go.
  const h2 = makeHarness({ rows: [chair('a-1', 1, 1_700_000_000_001)] });
  h2.e.snapOn = false;
  h2.e.sel.pick(['a-1'], 'set');
  await h2.e.step('move', 1, 0, 0);
  await h2.e.step('move', 1, 0, 0);
  await h2.e.undo(1);
  await h2.e.stepHold('lift', 2);
  ok(h2.e.history.actions.length === 2 && h2.e.history.at === 2 && h2.e.history.actions[1].label === 'lift' && !h2.e.history.canRedo, 'a new action after an undo lets what was undone go');
}

{
  // An action bigger than one request: consecutive batches, the same files as one, one undo entry.
  const rows: PlacementRow[] = [];
  for (let i = 0; i < 30; i++) rows.push({ ...chair(`crate-${i}`, i, 1_700_000_000_000), thing: 'crate' });
  const set = copyRows(rows.map((r) => ({ row: r, x: -r.x, y: r.y, z: r.z, q: [0, 0, 0, 1] as const })), { x: 0, y: 0, z: 0 }, 'tatooine');
  const plain = (t: string | null) => (t ?? '').replace(/"at": \d+/g, '"at": 0');
  const one = makeHarness({ rows: [chair('w-1', 100, 1_700_000_000_000)] });
  one.e.clip = set;
  await one.e.paste(null, false);
  ok(one.e.lastWrite?.batches === 1 && one.e.lastWrite.edits === 30, 'thirty rows pasted in one batch');
  const saved = EDITOR_TUNE.batchMost;
  EDITOR_TUNE.batchMost = 7;
  try {
    const chunked = makeHarness({ rows: [chair('w-1', 100, 1_700_000_000_000)] });
    const start = chunked.files.world;
    chunked.e.clip = set;
    await chunked.e.paste(null, false);
    ok(chunked.e.lastWrite?.batches === 5 && chunked.e.history.actions.length === 1, 'cut into requests of seven: written as five batches, and one undo entry');
    ok(plain(chunked.files.world) === plain(one.files.world), 'the same file as the one batch made (its moments aside)');
    const why = await chunked.e.undo(1);
    ok(why.startsWith('undone') && chunked.e.lastWrite?.batches === 5 && chunked.files.world === start, 'undone in batches of seven back to the file before, byte for byte');
  } finally {
    EDITOR_TUNE.batchMost = saved;
  }
}

{
  // The edits themselves.
  const r = chair('a-1', 1, 1_700_000_000_000);
  const a: EditAction = { label: 'x', changes: [{ file: 'world', id: 'a-1', before: r, after: { ...r, x: 2 } }, { file: 'world', id: 'a-2', before: null, after: chair('a-2', 3, 1_700_000_000_000) }] };
  const u = undoEdits(a);
  ok(u[0].delete === 'a-2' && u[1].put?.x === 1 && u[1].keepAt === true && (u[1].was as PlacementRow).x === 2, 'undo goes backwards: the made row taken out, the moved row put back with its own at, was the row as the action left it');
  const d = redoEdits(a);
  ok(d[0].put?.x === 2 && d[1].put?.id === 'a-2' && d[1].was === null, 'redo goes forwards, a made row put back under its id where none must stand');
  ok(doEdits(a).every((e) => !e.put || e.put.at === undefined), 'the first doing stamps every row with the moment');
}

{
  // The answered rows go to the last action of a plan to put each row, never to every action that touched it.
  const row = (x: number, at: number) => chair('c-1', x, at);
  const A: EditAction = { label: 'a', changes: [{ file: 'world', id: 'c-1', before: row(10, 1), after: row(12, 2) }] };
  const B: EditAction = { label: 'b', changes: [{ file: 'world', id: 'c-1', before: row(12, 2), after: row(14, 3) }] };
  // Undone newest first: B's before put, then A's; the file's answer is A's before as stamped.
  takeAnswered([B, A], 'before', { world: new Map([['c-1', row(10, 1)]]) });
  ok(B.changes[0].before!.x === 12 && A.changes[0].before!.x === 10, "jumped back over two moves of one row, the newer keeps its own `before` and the older takes the answer");
  takeAnswered([A, B], 'after', { world: new Map([['c-1', { ...row(14, 3), note: 'as stamped' }]]) });
  ok(A.changes[0].after!.x === 12 && B.changes[0].after!.note === 'as stamped', 'done again over both, the older keeps its own `after` and the newer takes the answer');
}

{
  // Map-maker II's groundwork: one action across two kinds of file -- a row of the world file and a tile of the heights file
  // (the sculpt brush's carry writes exactly this) -- done, undone and done again through the real editing class, both files
  // byte for byte each way, the tile's own moment kept.
  const { deflateRawSync } = await import('node:zlib');
  const tile = (v: number) => {
    const d = new Float32Array(1024);
    d[5] = v;
    return deflateRawSync(Buffer.from(d.buffer)).toString('base64');
  };
  const { heightsFileText } = await import('../../../src/world/editFiles/heightsFile.ts');
  const h = makeHarness({ rows: [chair('crate-1', 10, 1_700_000_000_001)], heights: heightsFileText('tatooine', [{ id: '0,0', d: tile(1), on: '00000000', at: 1_700_000_000_009 }]) });
  const start = { ...h.files };
  const was = h.rowOf('crate-1')!;
  const s = h.e.beginStroke('sculpt (raise)');
  const no = await h.e.strokeWrite(s, [
    { file: 'heights', id: '0,0', before: { id: '0,0', d: tile(1), on: '00000000', at: 1_700_000_000_009 }, after: { id: '0,0', d: tile(2.5), on: '00000000' } },
    { file: 'heights', id: '1,0', before: null, after: { id: '1,0', d: tile(0.5), on: '00000000' } },
    { file: 'world', id: 'crate-1', before: was, after: { ...was, y: was.y + 1.5, at: undefined } as unknown as PlacementRow },
  ]);
  h.e.endStroke(s);
  ok(no === '' && h.batches.length === 1, 'a stroke across two kinds is one batch');
  ok(/"id": "1,0"/.test(h.files.heights ?? '') && h.rowOf('crate-1')!.y === was.y + 1.5, 'the tile and the carried row are written');
  const done = { ...h.files };
  await h.e.undo(1);
  await h.settle();
  ok(h.files.world === start.world && h.files.heights === start.heights, 'undone, both files are back byte for byte (the tile its own moment)');
  await h.e.redo(1);
  await h.settle();
  ok(h.files.world === done.world && h.files.heights === done.heights, 'done again, both are what the stroke wrote byte for byte');
  ok(h.e.history.actions.length === 1, 'the stroke is one entry in the history');
}

console.log(`\n${checks} checks passed`);
