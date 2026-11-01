// The water file (Map-maker II's fifth wave, `src/world/editFiles/waterFile.ts`) and its kind in the batch: a lake a row,
// read and written by every build alike. Held here: a lake reads back as it was written (its look, its name, its shader,
// its points to the bit); a bad row is skipped and named and a bad header refuses the file whole; a river (the sixth
// wave's) is set aside, never read as a lake; a space zone keeps none; the text is one line a lake, sorted, so a change to
// one is a change to one line; and the batch writes it: a put minted from its name, `was` held, an undo (the endpoint's own
// `keepAt` and `was`) putting the file back byte for byte, the last lake out taking the file, a space zone refused.
//
// Run: node tools/swg/tests/waterFile.test.ts
import assert from 'node:assert/strict';
import { applyPlacementOp, type PlacementCtx } from '../../../src/world/placementEdits.ts';
import { mintWaterId, readWaterFile, readWaterLook, readWaterRow, sameWaterRow, waterFileText, WATER_LIMITS, type WaterLakeRow } from '../../../src/world/editFiles/waterFile.ts';
import { undoEdits, redoEdits } from '../../../src/editor/undo.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const W = 'naboo';
const glue = await import('../../../tools/dev/placementsEndpoint.mjs');
const worlds = new Map([[W, 'ground'], ['space_naboo', 'space'], ['dungeon1', 'copies']] as const);
const ctx = (now: number): PlacementCtx => ({ worlds, now, hash: glue.revisionOf });
const lake = (id: string, h: number, extra: Partial<WaterLakeRow> = {}): WaterLakeRow => ({ id, kind: 'lake', h, points: [[0.25, 0.5], [40, 0], [40, 40.125], [0, 40]], shader: null, ...extra });

{
  // Read and written.
  const a = lake('pond', 12.5, { name: 'The pond', shader: 'wter_spec', look: { color: '#2f6f8a', opacity: 0.8, ripple: 1.5, drift: 0.25 }, at: 5 });
  const b = lake('another', -3);
  const text = waterFileText(W, [a, b] as never);
  const read = readWaterFile(text, W, 'ground');
  ok(read.problem === null && read.rows.length === 2 && read.skipped.length === 0, 'a file of two lakes reads back whole');
  ok(read.rows[0].id === 'another' && read.rows[1].id === 'pond', 'its lakes sorted by id');
  ok(sameWaterRow(read.rows[1], a) && sameWaterRow(read.rows[0], b), 'each as written: its name, shader, look, height, points (to the bit) and moment');
  ok(text.split('\n').filter((l) => l.startsWith('    { ')).length === 2, 'one line a lake, so a change to one is a change to one line');
  ok(waterFileText(W, [b, a] as never) === text, 'and the text the same whichever order it was handed');
  ok(waterFileText(W, []).includes('"rows": []'), 'an empty file is a file of no rows');
}

{
  // Refusals.
  const bad = (row: unknown) => readWaterRow(row);
  ok(typeof bad({ ...lake('x', 1), id: 'Bad Id' }) === 'string', 'an id not a-z, 0-9, _ and - is refused');
  ok(typeof bad({ ...lake('x', 1), points: [[0, 0], [1, 1]] }) === 'string' && typeof bad({ ...lake('x', 1), points: [[0, 0], [1, 1], [2, 2]] }) === 'string', 'an outline of under three points, or of no area, is refused');
  ok(typeof bad({ ...lake('x', 1), h: Number.NaN }) === 'string' && typeof bad({ ...lake('x', WATER_LIMITS.height + 1) }) === 'string', 'a height that is not a number of metres within the backstop is refused');
  ok(typeof bad({ ...lake('x', 1), shader: 'has space' }) === 'string', 'a shader that is not a key is refused');
  ok(typeof readWaterLook({ color: 'blue' }) === 'string' && typeof readWaterLook({ opacity: 2 }) === 'string' && typeof readWaterLook({ glow: 1 }) === 'string', 'a look of a bad colour, a number out of its range or a field it has not got is refused');
  const river = readWaterRow({ id: 'r', kind: 'river', points: [[0, 0, 1]], width: 8 });
  ok(typeof river === 'string' && /sixth wave/.test(river), "a river is the sixth wave's, set aside in its words");
  const mixed = readWaterFile(JSON.stringify({ version: 1, world: W, frame: 'raw', rows: [lake('a', 1), { id: 'r', kind: 'river' }, { ...lake('a', 2) }, { id: 'x' }] }), W, 'ground');
  ok(mixed.rows.length === 1 && mixed.skipped.length === 3 && mixed.skipped.some((s) => /second lake/.test(s.why)), 'a bad row, a river and a second row under one id are skipped and named, the rest read');
  ok(readWaterFile('{', W, 'ground').problem !== null, 'a file that does not read is refused whole');
  ok(/tatooine's/.test(readWaterFile(waterFileText('tatooine', [lake('a', 1)] as never), W, 'ground').problem ?? ''), "a file of another world's is refused whole");
  ok(/raw/.test(readWaterFile(JSON.stringify({ version: 1, world: W, frame: 'game', rows: [] }), W, 'ground').problem ?? ''), 'a file not written in the raw frame is refused whole');
  ok(/later pass/.test(readWaterFile(waterFileText(W, []), W, 'space').problem ?? ''), 'a space zone keeps no water');
  const unknown: string[] = [];
  readWaterRow({ ...lake('u', 1), flow: 3 }, unknown);
  ok(unknown.join() === 'u.flow', 'a field this build does not read is named, never dropped silently');
  ok(mintWaterId('Spirit Lake', new Set()) === 'spirit-lake' && mintWaterId('Spirit Lake', new Set(['spirit-lake'])) === 'spirit-lake-2' && mintWaterId('', new Set()) === 'lake', 'a fresh id from a name, unique among those taken');
}

{
  // The batch.
  const put = applyPlacementOp({ op: 'batch', world: W, edits: [{ file: 'water', put: { kind: 'lake', name: 'The Mere', h: 5, points: [[0, 0], [10, 0], [10, 10]], shader: null } }] }, {}, ctx(1000));
  const body = put.body as { files: { water: { put: WaterLakeRow[]; rev: string } } };
  ok(put.status === 200 && put.writes.length === 1 && put.writes[0].layer === 'water', 'a lake is written into its own file');
  const made = body.files.water.put[0];
  ok(made.id === 'the-mere' && made.at === 1000, 'its id minted from its name, stamped with the endpoint\'s moment');
  const file1 = put.writes[0].text as string;
  // A second write over it, then its undo: the file byte for byte as it was.
  const moved = { ...made, h: 6 };
  delete (moved as { at?: number }).at;
  const second = applyPlacementOp({ op: 'batch', world: W, edits: [{ file: 'water', put: moved, was: made }] }, { water: file1 }, ctx(2000));
  ok(second.status === 200, 'a lake moved, its was held');
  const after = (second.body as typeof body).files.water.put[0];
  const action = { label: 'raised', changes: [{ file: 'water' as const, id: made.id, before: made, after }] };
  const undo = applyPlacementOp({ op: 'batch', world: W, edits: undoEdits(action) }, { water: second.writes[0].text as string }, ctx(3000));
  ok(undo.status === 200 && undo.writes[0].text === file1, 'its undo puts the file back byte for byte (its own moment kept)');
  const redo = applyPlacementOp({ op: 'batch', world: W, edits: redoEdits(action) }, { water: file1 }, ctx(4000));
  ok(redo.status === 200 && redo.writes[0].text === second.writes[0].text, 'and its redo puts the second write back byte for byte');
  const stale = applyPlacementOp({ op: 'batch', world: W, edits: [{ file: 'water', put: moved, was: { ...made, h: 99 } }] }, { water: file1 }, ctx(5000));
  ok(stale.status === 409 && !stale.writes.length, 'a lake changed since the editor read it is refused by name and nothing written');
  const out = applyPlacementOp({ op: 'batch', world: W, edits: [{ file: 'water', delete: made.id, was: made }] }, { water: file1 }, ctx(6000));
  ok(out.status === 200 && out.writes.length === 1 && out.writes[0].text === null, 'the last lake out takes the file');
  const space = applyPlacementOp({ op: 'batch', world: 'space_naboo', edits: [{ file: 'water', put: lake('a', 1) }] }, {}, ctx(7000));
  ok(space.status === 409 && /space maps are a later pass/.test((space.body as { why: string }).why), 'a space zone\'s water is refused: the ground\'s alone');
  const river = applyPlacementOp({ op: 'batch', world: W, edits: [{ file: 'water', put: { id: 'r', kind: 'river', points: [[0, 0, 1], [10, 0, 0]], width: 8 } }] }, {}, ctx(8000));
  ok(river.status === 400 && /sixth wave/.test((river.body as { why: string }).why), "a river is refused in the sixth wave's words");
}

console.log(`waterFile: ${checks} checks passed`);
