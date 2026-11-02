// The writer of the owner's shared walk-through file (`public/placements/solid.json`, the map fixes' third wave), which the
// world editor's "every world" switch writes from Map-maker II's twelfth wave: run over a copy of the committed file through
// the very batch the dev server's endpoint runs (`applyPlacementOp`'s `solid` kind, `solidFileText`, `readSolidFileRows`),
// never over the file itself. A flip and its flip back, a new template put and taken out again, are the file to the byte; a
// row taken out and put back by an undo comes back at the file's end (the batch keys a row by its template and keeps no
// place for it: pinned here, the one way an undo of this file is not the bytes it was); no time is ever stamped into it; the
// last row taken out takes the file away, as every edit file's last row does; and the file is found where the game, the
// endpoint and the dev server's watcher look for it.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyPlacementOp, type PlacementCtx } from '../../../src/world/placementEdits.ts';
import { readSolidFileRows, solidFileText } from '../../../src/world/walkThrough.ts';
import { editFileOf, editFilePath } from '../../../src/story/placementPath.ts';
import { REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// The committed file (what HEAD holds; the owner's working copy, which may hold edits of his, only where git cannot answer),
// with its line endings folded to LF as the checkout's own writer writes it.
let committed: string;
try {
  committed = execFileSync('git', ['show', 'HEAD:public/placements/solid.json'], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
} catch {
  committed = readFileSync(join(REPO, 'public/placements/solid.json'), 'utf8');
  console.log('note git could not hand HEAD\'s solid.json over: the working copy is read');
}
committed = committed.replace(/\r\n/g, '\n');
const first = readSolidFileRows(committed);
ok(first.problem === null && first.skipped.length === 0 && first.rows.length > 3, `the committed file reads whole (${first.rows.length} rows)`);
ok(solidFileText(first.rows) === committed, 'and written again from its rows it is the same bytes');

const ctx = (): PlacementCtx => ({ worlds: new Map([['tatooine', 'ground']]), now: 1_800_000_000_000, hash: (t: string) => t.length.toString(16).padStart(12, '0') });
/** One batch of the shared file's edits over `text`, answering the text written (null: the file taken away). */
function batch(text: string | null, edits: Record<string, unknown>[]): string | null {
  const a = applyPlacementOp({ op: 'batch', world: 'tatooine', edits: edits.map((e) => ({ file: 'solid', ...e })) }, { solid: text }, ctx());
  assert.equal(a.status, 200, JSON.stringify(a.body));
  const w = a.writes.find((x) => x.layer === 'solid');
  assert.ok(w, 'the batch writes the shared file');
  return w!.text;
}

{
  const mid = first.rows[Math.floor(first.rows.length / 2)];
  const flipped = batch(committed, [{ put: { id: mid.id, solid: !mid.solid } }])!;
  ok(flipped !== committed && readSolidFileRows(flipped).rows.find((r) => r.id === mid.id)?.solid === !mid.solid, 'a row flipped is written where it stands');
  ok(batch(flipped, [{ put: { id: mid.id, solid: mid.solid } }]) === committed, 'and flipped back the file is the same bytes');
  const fresh = 'object/tangible/test/shared_test_walk_through_w12.iff';
  const added = batch(committed, [{ put: { id: fresh, solid: false } }])!;
  ok(readSolidFileRows(added).rows.at(-1)?.id === fresh, 'a new template is put after the rest');
  ok(batch(added, [{ delete: fresh }]) === committed, 'and taken out again the file is the same bytes');
  ok(!/"at"/.test(added) && !/1800000000000/.test(added), 'no time is ever stamped into it');
  const without = batch(committed, [{ delete: mid.id }])!;
  const back = batch(without, [{ put: { id: mid.id, solid: mid.solid } }])!;
  const backRows = readSolidFileRows(back).rows;
  ok(backRows.length === first.rows.length && backRows.at(-1)?.id === mid.id && back !== committed, 'a middle row taken out and put back by an undo is every row again, the one put back at the end (the batch keeps no place for it)');
  ok(JSON.stringify(backRows.map((r) => [r.id, r.solid]).sort()) === JSON.stringify(first.rows.map((r) => [r.id, r.solid]).sort()), 'and the rows themselves are exactly the file\'s');
  // The last row taken out takes the file away (`writeKindBack`: a file left with no rows), as every edit file's does, and
  // the game and the bake read no file as no row: putting it back writes it again.
  const one = solidFileText([{ id: fresh, solid: false }]);
  ok(batch(one, [{ delete: fresh }]) === null, 'the last row taken out takes the file away');
  ok(batch(null, [{ put: { id: fresh, solid: false } }]) === one, 'and an undo of that writes it again, byte for byte');
  // A file carrying anything but its version and its scope is refused whole rather than written over.
  const strange = applyPlacementOp({ op: 'batch', world: 'tatooine', edits: [{ file: 'solid', put: { id: fresh, solid: true } }] }, { solid: committed.replace('"version": 1,', '"version": 1,\n "note": "mine",') }, ctx());
  ok(strange.status !== 200 && strange.writes.length === 0, `a file carrying a key of the owner's own is never written over (${strange.status})`);
}

// ---- where the file is -----------------------------------------------------------------------------------------------------------
{
  const { fileFor } = (await import('../../dev/placementsEndpoint.mjs')) as { fileFor: (dir: string, layer: string, world: string) => string };
  const dir = join(tmpdir(), 'placements');
  ok(fileFor(dir, 'solid', 'tatooine') === join(dir, 'solid.json') && fileFor(dir, 'solid', 'all') === join(dir, 'solid.json'), 'the endpoint writes exactly the folder\'s own solid.json, for any world it is asked about');
  const word = editFileOf('solid.json');
  ok(!!word && word.kind === 'solid' && word.world === 'all' && editFileOf('solid/all.json') === null, "the dev server's watcher names it the shared file of every world, and nothing in a solid folder");
  ok(editFilePath('solid', 'tatooine') === 'placements/solid.json', 'and the game asks for it at the folder\'s top');
}

console.log(`\n${checks} checks passed`);
