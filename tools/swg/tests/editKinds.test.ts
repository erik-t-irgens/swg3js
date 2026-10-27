// Map-maker II's groundwork (DESIGN.md §2.2, W0): the edit files' kinds and the batch made generic over them, held to the
// batch as it stood before the kinds. The day-one proof: e6c2578's `placementEdits.ts`, `placements.ts` and
// `placementPath.ts` loaded out of git beside today's, both handed the same corpus of story and world batches -- puts,
// deletes, `was` held and refused, `keepAt`, minted ids, rows moved between the files, a 5,000-edit batch over a file of
// thousands -- and every answer's status, body and file texts equal. Then the kinds of later waves refused in their words,
// a heights edit taken (the first wave's kind), and `statusFiles` naming every kind.
//
// Run: node tools/swg/tests/editKinds.test.ts
import assert from 'node:assert/strict';
import { inflateRawSync, deflateRawSync } from 'node:zlib';
import { applyPlacementOp, statusFiles, type BatchEdit, type PlacementCtx } from '../../../src/world/placementEdits.ts';
import { placementsFileText, type PlacementRow } from '../../../src/story/placements.ts';
import { EDIT_FILE_KINDS, editFilePath } from '../../../src/story/placementPath.ts';
import { HEIGHT_TILE_DELTAS } from '../../../src/swg/terrain/heightEdits.ts';
import { loadOld } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);

const W = 'tatooine';
const glue = await import('../../../tools/dev/placementsEndpoint.mjs');
const worlds = new Map([[W, 'ground'], ['space_tatooine', 'space'], ['dungeon1', 'copies']] as const);
const inflate = (b64: string) => {
  try {
    return new Uint8Array(inflateRawSync(Buffer.from(b64, 'base64')));
  } catch {
    return null;
  }
};
const prop = (id: string, x: number, thing = 'chair', at = 1_700_000_000_000): PlacementRow => ({ id, kind: 'prop', pack: 'props', thing, x, y: 1, z: -x, q: [1, 0, 0, 0], at });

type Op = (op: unknown, current: Record<string, string | null>, ctx: PlacementCtx) => { status: number; body: unknown; writes: { layer: string; text: string | null }[] };
const old = await loadOld<{ applyPlacementOp: Op }>(['src/world/placementEdits.ts', 'src/story/placements.ts', 'src/story/placementPath.ts'], 'src/world/placementEdits.ts');
if (!old) note('git cannot hand e6c2578 over here: the day-one comparison is skipped');

/** A corpus of batches, each with the files it runs over. */
function corpus(): { name: string; world: string; current: { story: string | null; world: string | null }; edits: BatchEdit[] }[] {
  const base = { story: placementsFileText(W, 'raw', [prop('stool-1', 1, 'stool')]), world: placementsFileText(W, 'raw', [prop('chair-1', 2), prop('chair-2', 3)]) };
  const big: PlacementRow[] = [];
  for (let i = 0; i < 3000; i++) big.push(prop(`crate-${i}`, i * 0.5, 'crate'));
  const bigFile = { story: null, world: placementsFileText(W, 'raw', big) };
  const many: BatchEdit[] = [];
  for (let i = 0; i < 2500; i++) many.push({ file: 'world', put: { kind: 'prop', pack: 'props', thing: 'crate', x: 9000 + i, y: 0, z: 0, q: [1, 0, 0, 0] } });
  for (let i = 0; i < 2500; i++) many.push({ file: 'world', delete: `crate-${i}`, was: prop(`crate-${i}`, i * 0.5, 'crate') });
  return [
    { name: 'puts minted across both files and a delete', world: W, current: base, edits: [{ file: 'world', put: { kind: 'prop', pack: 'props', thing: 'chair', x: 9, y: 0, z: 0, q: [1, 0, 0, 0] } }, { file: 'world', put: { kind: 'prop', pack: 'props', thing: 'chair', x: 10, y: 0, z: 0, q: [1, 0, 0, 0] } }, { file: 'story', put: { id: 'given-7', kind: 'prop', pack: 'props', thing: 'stool', x: 4, y: 0, z: 0, q: [1, 0, 0, 0] } }, { file: 'world', delete: 'chair-2' }] },
    { name: 'a refusal part way writes nothing', world: W, current: base, edits: [{ file: 'world', put: prop('chair-1', 50) }, { file: 'world', delete: 'chair-99' }] },
    { name: 'an id the other file holds', world: W, current: base, edits: [{ file: 'story', put: prop('chair-1', 5) }] },
    { name: 'a row moved between the files, keepAt', world: W, current: base, edits: [{ file: 'world', delete: 'chair-1', was: prop('chair-1', 2) }, { file: 'story', put: prop('chair-1', 2), was: null, keepAt: true }] },
    { name: 'was held', world: W, current: base, edits: [{ file: 'world', put: prop('chair-1', 2), keepAt: true, was: prop('chair-1', 2) }] },
    { name: 'was refused', world: W, current: base, edits: [{ file: 'world', put: prop('chair-1', 7), was: { ...prop('chair-1', 2), x: 2.5 } }] },
    { name: 'was null over a row', world: W, current: base, edits: [{ file: 'world', put: prop('chair-1', 7), was: null }] },
    { name: 'keepAt with no at', world: W, current: base, edits: [{ file: 'world', put: { ...prop('chair-1', 7), at: undefined } as unknown as PlacementRow, keepAt: true }] },
    { name: 'the last row out takes the file', world: W, current: base, edits: [{ file: 'story', delete: 'stool-1' }] },
    { name: 'a fresh file', world: W, current: { story: null, world: null }, edits: [{ file: 'story', put: prop('lamp-1', 1, 'lamp') }] },
    { name: 'the world of copies', world: 'dungeon1', current: base, edits: [{ file: 'world', put: prop('a-1', 1) }] },
    { name: 'a world there is not', world: 'nowhere', current: base, edits: [{ file: 'world', put: prop('a-1', 1) }] },
    { name: 'a space zone', world: 'space_tatooine', current: { story: null, world: null }, edits: [{ file: 'world', put: { ...prop('rock-1', 100), y: 5 } }] },
    { name: 'a 5,000-edit batch over a file of 3,000', world: W, current: bigFile, edits: many },
  ];
}

if (old) {
  let clockA = 1_800_000_000_000;
  let clockB = 1_800_000_000_000;
  for (const c of corpus()) {
    const ctxA: PlacementCtx = { worlds, now: (clockA += 1000), hash: glue.revisionOf };
    const ctxB: PlacementCtx = { worlds, now: (clockB += 1000), hash: glue.revisionOf };
    const a = old.applyPlacementOp({ op: 'batch', world: c.world, edits: c.edits }, c.current, ctxA);
    const b = applyPlacementOp({ op: 'batch', world: c.world, edits: c.edits }, c.current, ctxB);
    ok(a.status === b.status && JSON.stringify(a.body) === JSON.stringify(b.body), `${c.name}: the answer is e6c2578's, status and body (${b.status})`);
    ok(JSON.stringify(a.writes) === JSON.stringify(b.writes), `${c.name}: the file texts written are e6c2578's to the byte (${b.writes.length} file${b.writes.length === 1 ? '' : 's'})`);
  }
}

// The kinds of later waves refused in their words, never written.
{
  const base = { story: null, world: null };
  const ctx = (): PlacementCtx => ({ worlds, now: 1, hash: glue.revisionOf, inflate });
  const words: Record<string, RegExp> = { removed: /fifth wave/, people: /fifth wave/, paint: /second wave/, water: /fifth wave/, locations: /eighth wave/, looks: /thirteenth wave/ };
  for (const [k, re] of Object.entries(words)) {
    const r = applyPlacementOp({ op: 'batch', world: W, edits: [{ file: k, delete: 'x-1' }] }, base, ctx());
    ok(r.status === 400 && re.test((r.body as { why: string }).why) && /does not write yet/.test((r.body as { why: string }).why) && !r.writes.length, `the ${k} file is refused in its wave's words, never written`);
  }
  // A heights tile (the first wave's): taken, its deltas checked through the inflate the glue hands in.
  const d = new Float32Array(HEIGHT_TILE_DELTAS);
  d[33] = 1.5;
  const b64 = deflateRawSync(Buffer.from(d.buffer)).toString('base64');
  const put = applyPlacementOp({ op: 'batch', world: W, edits: [{ file: 'heights', put: { id: '3,-2', d: b64, on: '0123abcd' } }] }, base, ctx());
  ok(put.status === 200 && put.writes.length === 1 && put.writes[0].layer === 'heights' && /"id": "3,-2"/.test(put.writes[0].text ?? ''), 'a heights tile is written into its own file');
  const zero = deflateRawSync(Buffer.from(new Float32Array(HEIGHT_TILE_DELTAS).buffer)).toString('base64');
  const nought = applyPlacementOp({ op: 'batch', world: W, edits: [{ file: 'heights', put: { id: '3,-2', d: zero, on: '0123abcd' } }] }, base, ctx());
  ok(nought.status === 400 && /nought/.test((nought.body as { why: string }).why), 'a tile of noughts is refused (it is taken out instead)');
  const space = applyPlacementOp({ op: 'batch', world: 'space_tatooine', edits: [{ file: 'heights', put: { id: '0,0', d: b64, on: '0123abcd' } }] }, base, ctx());
  ok(space.status === 409 && /space maps are a later pass/.test((space.body as { why: string }).why), "a space zone's heights are refused: the ground's alone");
  const noInflate = applyPlacementOp({ op: 'batch', world: W, edits: [{ file: 'heights', put: { id: '0,0', d: b64, on: '0123abcd' } }] }, base, { worlds, now: 1, hash: glue.revisionOf });
  ok(noInflate.status === 400 && /inflate/.test((noInflate.body as { why: string }).why), 'an endpoint handed no inflate refuses a tile in words');

  // `was` on a heights tile (the kind's likeness, `sameTile`): an undo or a redo never writes over a tile changed since the
  // editor read it -- its deltas, its digest or its moment -- nor puts as new a tile the file already holds; and the tile as
  // read is taken.
  const held = { ...base, heights: (put.writes[0].text as string) };
  const asRead = { id: '3,-2', d: b64, on: '0123abcd', at: 1 };
  const d2 = new Float32Array(HEIGHT_TILE_DELTAS);
  d2[33] = 2.5;
  const b64b = deflateRawSync(Buffer.from(d2.buffer)).toString('base64');
  const changed = (why: string) => /has changed in .* since the editor read it/.test(why);
  const tries: { name: string; edits: BatchEdit[]; want: (status: number, why: string) => boolean }[] = [
    { name: 'its deltas', edits: [{ file: 'heights', put: { id: '3,-2', d: b64b, on: '0123abcd' }, was: { ...asRead, d: b64b } }], want: (s, w) => s === 409 && changed(w) },
    { name: 'its moment', edits: [{ file: 'heights', put: { id: '3,-2', d: b64b, on: '0123abcd' }, was: { ...asRead, at: 2 } }], want: (s, w) => s === 409 && changed(w) },
    { name: 'its digest', edits: [{ file: 'heights', delete: '3,-2', was: { ...asRead, on: 'ffffffff' } }], want: (s, w) => s === 409 && changed(w) },
    { name: 'a delete naming it new (was null)', edits: [{ file: 'heights', delete: '3,-2', was: null }], want: (s, w) => s === 409 && /is in .* already/.test(w) },
    { name: 'a put naming it new (was null)', edits: [{ file: 'heights', put: { id: '3,-2', d: b64b, on: '0123abcd' }, was: null }], want: (s, w) => s === 409 && /is in .* already/.test(w) },
  ];
  for (const t of tries) {
    const r = applyPlacementOp({ op: 'batch', world: W, edits: t.edits }, held, ctx());
    const why = (r.body as { why?: string }).why ?? '';
    ok(t.want(r.status, why) && !r.writes.length, `a heights edit whose was differs from the file in ${t.name} is refused and writes nothing (${r.status}: ${why})`);
  }
  const taken = applyPlacementOp({ op: 'batch', world: W, edits: [{ file: 'heights', put: { id: '3,-2', d: b64b, on: '0123abcd' }, was: asRead }] }, held, ctx());
  ok(taken.status === 200 && taken.writes.length === 1, 'and one whose was is the tile as read is taken (the control)');
}

// `statusFiles` names every kind of edit file and the track file, and the shared kind by its one file.
{
  const s = statusFiles(W);
  ok(EDIT_FILE_KINDS.every((k) => s.some((f) => f.kind === k && f.path === `public/${editFilePath(k, W)}`)) && s.some((f) => f.kind === 'track'), `statusFiles lists every kind (${s.length} files)`);
  ok(s.find((f) => f.kind === 'looks')?.path === 'public/placements/looks/all.json', "the looks are every world's one file (all.json)");
}

console.log(`\neditKinds: ${checks} checks passed`);
