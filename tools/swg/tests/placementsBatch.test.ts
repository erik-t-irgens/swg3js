// The world editor's one write, the endpoint's `batch` (DESIGN.md §2.11), run as node runs the rules and as the dev
// server's glue runs them over HTTP against real files: every edit across both files applied in order and nothing written
// unless all of it holds; a given id kept and a missing one minted, unique across both files and the batch itself; `was`
// refusing a row that changed since by its id; `keepAt` keeping a row's own moment; a row moved between the files in one
// batch; the fifth wave's kinds of file and the copies' world refused in words; the caps; each file's revision twelve hex
// of the SHA-1 of the text written, told to the page with its kind once the answer has gone; a file of 20,000 rows taking
// a batch of 5,000 edits; and the one-row ops answering as they did, with their revisions beside.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BATCH_MOST, EDITOR_HEADER, EDITOR_HEADER_VALUE, applyPlacementOp, type BatchEdit, type PlacementBatchOk, type PlacementCtx, type PlacementReplyOk } from '../../../src/world/placementEdits.ts';
import { PLACEMENT_LIMITS, placementsFileText, readPlacementsFile, type PlacementRow } from '../../../src/story/placements.ts';

const glue = await import('../../../tools/dev/placementsEndpoint.mjs');
const REPO = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const W = 'tatooine';
let clock = 1_800_000_000_000;
const ctx = (): PlacementCtx => ({ worlds: new Map([[W, 'ground'], ['space_tatooine', 'space'], ['dungeon1', 'copies']]), now: (clock += 1000), hash: glue.revisionOf });
const prop = (id: string, x: number, thing = 'chair', at = 1_700_000_000_000): PlacementRow => ({ id, kind: 'prop', pack: 'props', thing, x, y: 1, z: -x, q: [1, 0, 0, 0], at });
const run = (edits: BatchEdit[], current: { story: string | null; world: string | null }, world = W) => applyPlacementOp({ op: 'batch', world, edits }, current, ctx());
const rows = (text: string | null) => (text ? readPlacementsFile(text, W, 'ground').rows : []);

{
  const current = { story: placementsFileText(W, 'raw', [prop('stool-1', 1, 'stool')]), world: placementsFileText(W, 'raw', [prop('chair-1', 2), prop('chair-2', 3)]) };
  const a = run(
    [
      { file: 'world', put: { kind: 'prop', pack: 'props', thing: 'chair', x: 9, y: 0, z: 0, q: [1, 0, 0, 0] } },
      { file: 'world', put: { kind: 'prop', pack: 'props', thing: 'chair', x: 10, y: 0, z: 0, q: [1, 0, 0, 0] } },
      { file: 'story', put: { id: 'given-7', kind: 'prop', pack: 'props', thing: 'stool', x: 4, y: 0, z: 0, q: [1, 0, 0, 0] } },
      { file: 'world', delete: 'chair-2' },
    ],
    current,
  );
  const body = a.body as PlacementBatchOk;
  ok(a.status === 200 && body.op === 'batch' && a.writes.length === 2, 'a batch across both files writes both');
  const minted = body.files.world!.put.map((r) => r.id);
  ok(minted.join() === 'chair-3,chair-4', `ids not given are minted from the thing, unique across both files and the batch itself (${minted.join(', ')})`);
  ok(body.files.story!.put[0].id === 'given-7', 'a given id is kept');
  ok(body.files.world!.deleted.join() === 'chair-2' && body.files.world!.rows === 3 && body.files.story!.rows === 2, 'the answer names the ids taken out and how many rows each file holds now');
  const ws = a.writes.find((w) => w.layer === 'world')!;
  ok(body.files.world!.rev === glue.revisionOf(ws.text!) && /^[0-9a-f]{12}$/.test(body.files.world!.rev), `each file's revision is twelve hex of the SHA-1 of the text written (${body.files.world!.rev})`);
  ok(body.files.world!.put.every((r) => r.at === clock), 'every row put is stamped with the moment');

  // All or nothing: a good edit and then one refused.
  const b = run([{ file: 'world', put: prop('chair-1', 50) }, { file: 'world', delete: 'chair-99' }], current);
  ok(b.status === 404 && b.writes.length === 0 && /chair-99 is not in/.test((b.body as { why: string }).why), 'a batch with one edit refused writes nothing at all, and says which');
  const c = run([{ file: 'story', put: prop('chair-1', 5) }], current);
  ok(c.status === 409 && /chair-1 is in the world edits/.test((c.body as { why: string }).why), 'a given id the other file holds is refused');
  const moveAcross = run([{ file: 'world', delete: 'chair-1', was: prop('chair-1', 2) }, { file: 'story', put: prop('chair-1', 2), was: null, keepAt: true }], current);
  ok(moveAcross.status === 200 && rows(moveAcross.writes.find((w) => w.layer === 'story')!.text).some((r) => r.id === 'chair-1' && r.at === 1_700_000_000_000), "a row moved between the files in one batch, its own moment kept (keepAt)");
  ok(run([{ file: 'world', put: prop('chair-1', 2), keepAt: true, was: prop('chair-1', 2) }], current).status === 200, 'a row put back as it was, its was the row as it stands');
  const changed = run([{ file: 'world', put: prop('chair-1', 7), was: { ...prop('chair-1', 2), x: 2.5 } }], current);
  ok(changed.status === 409 && /chair-1 has changed/.test((changed.body as { why: string }).why), 'a row whose was is not the row as it stands is refused by its id');
  ok(run([{ file: 'world', put: prop('chair-1', 7), was: null }], current).status === 409, 'and so is a put whose was says none must stand where one does');
  ok(run([{ file: 'world', put: { ...prop('chair-1', 7), at: undefined }, keepAt: true }], current).status === 400, 'keepAt asks for a row carrying its own at');
  ok(run([{ file: 'removed', delete: 'x-1' }], current).status === 400 && /fifth wave/.test((run([{ file: 'people', delete: 'x-1' }], current).body as { why: string }).why), "the fifth wave's kinds of file are refused in words until it writes them");
  ok(run([{ file: 'world', put: prop('a-1', 1) }], current, 'dungeon1').status === 409, "nothing stands for good in the world of copies");
  ok(run([{ file: 'world', put: prop('a-1', 1) }], current, 'nowhere').status === 404 && run([], current).status === 400, 'a world there is not, and a batch of nothing, are refused');
  const space = applyPlacementOp({ op: 'batch', world: 'space_tatooine', edits: [{ file: 'world', put: { ...prop('rock-1', 100), y: 5 } }] }, { story: null, world: null }, ctx());
  ok(space.status === 200 && /"frame": "game"/.test(space.writes[0].text!), "a space zone's file is written in the game's own frame");
  ok(run([{ file: 'world', put: prop('a-1', 1) }, { file: 'world', put: { kind: 'prop' } }], current).status === 400, 'a row that would not read refuses the batch');
}

{
  // The caps.
  const many = Array.from({ length: BATCH_MOST + 1 }, () => ({ file: 'world' as const, delete: 'x' }));
  const over = run(many, { story: null, world: null });
  ok(over.status === 413, `a batch is ${BATCH_MOST} edits at most (twice the rows a file may hold)`);
  const keep = PLACEMENT_LIMITS.rows;
  try {
    (PLACEMENT_LIMITS as { rows: number }).rows = 3;
    const full = { story: null, world: placementsFileText(W, 'raw', [prop('a-1', 1), prop('a-2', 2)]) };
    ok(run([{ file: 'world', put: prop('a-3', 3) }], full).status === 200, 'a file takes rows up to its cap');
    const r = run([{ file: 'world', put: prop('a-3', 3) }, { file: 'world', put: prop('a-4', 4) }], full);
    ok(r.status === 409 && /as many as a file may/.test((r.body as { why: string }).why), 'and refuses the one past it, the whole batch with it');
    ok(run([{ file: 'world', delete: 'a-1' }, { file: 'world', put: prop('a-3', 3) }, { file: 'world', put: prop('a-4', 4) }], full).status === 200, 'a row taken out earlier in the batch makes room');
  } finally {
    (PLACEMENT_LIMITS as { rows: number }).rows = keep;
  }
}

{
  // A file of 20,000 rows, a batch of 5,000 edits: half moved, a fifth taken out, the rest new.
  const big: PlacementRow[] = [];
  for (let i = 0; i < 20_000; i++) big.push(prop(`crate-${i}`, i * 0.5, 'crate'));
  const text = placementsFileText(W, 'raw', big);
  const edits: BatchEdit[] = [];
  for (let i = 0; i < 2_500; i++) edits.push({ file: 'world', put: { ...big[i * 7], x: big[i * 7].x + 0.25 }, was: big[i * 7] });
  for (let i = 0; i < 1_000; i++) edits.push({ file: 'world', delete: `crate-${i * 7 + 3}` });
  for (let i = 0; i < 1_500; i++) edits.push({ file: 'world', put: { kind: 'prop', pack: 'props', thing: 'barrel', x: i, y: 0, z: 0, q: [1, 0, 0, 0] } });
  const t0 = performance.now();
  const a = run(edits, { story: null, world: text });
  const ms = performance.now() - t0;
  const body = a.body as PlacementBatchOk;
  ok(a.status === 200 && body.files.world!.rows === 20_500 && rows(a.writes[0].text).length === 20_500, `a batch of 5,000 edits on a file of 20,000 rows lands whole: 20,500 rows (${Math.round(ms)} ms, read back and checked)`);
  ok(ms < 20_000, `and in seconds, not minutes (${(ms / 1000).toFixed(1)} s): the read-back is a map by id, not a find a row`);
}

{
  // The read-back looks rows up in a map, never a find a row (669 ms at 10,000 rows and two seconds at 20,000 that way).
  const src = fs.readFileSync(path.join(REPO, 'src', 'world', 'placementEdits.ts'), 'utf8').split(/\r?\n/).join('\n');
  ok(/const backById = new Map<string, PlacementRow>\(\);\s*for \(const r of back\.rows\) backById\.set\(r\.id, r\);/.test(src) && !/back\.rows\.find\(/.test(src), "the read-back is a map by id (writeBack's backById)");
  // Map-maker II's generic batch keeps each kind's taken-out rows by kind (`gone.get(l)`) and filters them out once, at the end.
  ok(/const gn = gone\.get\(l\)!;\s*if \(gn\.size\) h\.rows = h\.rows\.filter\(\(_, i\) => !gn\.has\(i\)\);/.test(src), 'and rows taken out are taken out together at the end, never spliced an edit');
  const g = fs.readFileSync(path.join(REPO, 'tools', 'dev', 'placementsEndpoint.mjs'), 'utf8').split(/\r?\n/).join('\n');
  ok(/answer\(res, 200, out\.body\);\s*for \(const w of written\) notify\(w\);/.test(g), 'the glue answers first and then tells the page, so the page lands the answer and drops the word about what it landed');
}

// ---- Over HTTP, as the dev server runs it. ----
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'swg3js-batch-'));
const dir = path.join(scratch, 'public', 'placements');
try {
  const said: { kind: string; layer: string; world: string; rev: string }[] = [];
  const server = http.createServer((req, res) => {
    void glue.handle(req, res, { dir, notify: (w: { kind: string; layer: string; world: string; rev: string }) => said.push(w), now: () => (clock += 1000) });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const ask = async (op: unknown) => {
    const res = await fetch(`${origin}/`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, [EDITOR_HEADER]: EDITOR_HEADER_VALUE }, body: JSON.stringify(op) });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  try {
    const put = await ask({ op: 'batch', world: W, edits: [{ file: 'world', put: prop('chair-1', 1) }, { file: 'story', put: prop('stool-1', 2, 'stool') }] });
    const b = put.body as unknown as PlacementBatchOk;
    const wText = fs.readFileSync(path.join(dir, 'world', `${W}.json`), 'utf8');
    ok(put.status === 200 && b.files.world!.rev === glue.revisionOf(wText) && typeof b.ms === 'number', `over HTTP a batch writes both files, each revision the SHA-1 of the file on disk, with the endpoint's own milliseconds (${b.ms} ms)`);
    ok(said.length === 2 && said.every((w) => w.kind === w.layer && w.world === W) && said.find((w) => w.layer === 'world')!.rev === b.files.world!.rev, 'and tells the page of each file once, with its kind and its revision');
    ok(fs.readdirSync(path.join(dir, 'world')).join() === `${W}.json`, 'leaving nothing beside the file');
    said.length = 0;
    const one = await ask({ op: 'put', layer: 'world', world: W, row: prop('chair-2', 3) });
    const o = one.body as unknown as PlacementReplyOk;
    ok(one.status === 200 && o.op === 'put' && o.id === 'chair-2' && o.world!.rows.length === 2 && o.revs?.world === glue.revisionOf(fs.readFileSync(path.join(dir, 'world', `${W}.json`), 'utf8')), "a one-row put answers as it did, its layers as they read now, with the file's revision beside");
    ok(said.length === 1 && said[0].rev === o.revs!.world, 'and the page is told its revision too');
    const gone = await ask({ op: 'batch', world: W, edits: [{ file: 'world', delete: 'chair-1' }, { file: 'world', delete: 'chair-2' }, { file: 'story', delete: 'stool-1' }] });
    ok(gone.status === 200 && !fs.existsSync(dir), 'a batch taking out every row takes both files away, and the emptied folders with them');
    ok((gone.body as unknown as PlacementBatchOk).files.world!.rev === '' && said.at(-1)!.rev === '', "a file taken away has the revision ''");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

console.log(`\n${checks} checks passed`);
