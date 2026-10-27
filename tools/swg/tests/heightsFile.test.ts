// The heights file (Map-maker II, DESIGN.md §2.4, `src/world/editFiles/heightsFile.ts`): its reader, cleaner and writer; a
// nought tile dropped and the file gone with its last tile (through the endpoint's own batch); the backstops
// (`HEIGHTS_LIMITS`); a deflated tile round trip through node's `zlib` (the dev server's glue) and the browser's own
// `DecompressionStream` / `CompressionStream` (`browserCodec.ts`, which node 22 has too), each reading what the other wrote;
// a store read whole (`storeOfRead`); and the digest of the raw ground a tile was authored over.
//
// Run: node tools/swg/tests/heightsFile.test.ts
import assert from 'node:assert/strict';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { deltaBytes, deltasOf, HEIGHTS_LIMITS, heightsFileText, isTileId, readHeightsFile, readTileRow, storeOfRead, tileIdOf, tileOfId } from '../../../src/world/editFiles/heightsFile.ts';
import { HEIGHT_TILE_DELTAS, fnv1aHeights } from '../../../src/swg/terrain/heightEdits.ts';
import { deflateBase64, inflateBase64 } from '../../../src/world/editFiles/browserCodec.ts';
import { applyPlacementOp } from '../../../src/world/placementEdits.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const nodeInflate = (b64: string) => {
  try {
    return new Uint8Array(inflateRawSync(Buffer.from(b64, 'base64')));
  } catch {
    return null;
  }
};
const deltas = (f: (i: number) => number) => {
  const d = new Float32Array(HEIGHT_TILE_DELTAS);
  for (let i = 0; i < d.length; i++) d[i] = f(i);
  return d;
};
const nodeDeflate = (d: Float32Array) => deflateRawSync(Buffer.from(deltaBytes(d))).toString('base64');

// Ids.
ok(isTileId('12,-3') && isTileId('-4095,4095') && !isTileId('12.5,3') && !isTileId('a,b') && !isTileId('123456,0'), 'a tile id is "tx,tz" of whole numbers, five digits at most');
ok(tileIdOf(-7, 22) === '-7,22' && tileOfId('-7,22').tx === -7 && tileOfId('-7,22').tz === 22, "a tile's id and its place, both ways");

// The codecs, each reading what the other wrote.
{
  const d = deltas((i) => Math.sin(i * 0.1) * 3);
  const viaNode = nodeDeflate(d);
  const back = deltasOf(await inflateBase64(viaNode));
  ok(back instanceof Float32Array && back.every((v, i) => Object.is(v, d[i])), "node's zlib writes, the browser's DecompressionStream reads it back to the bit");
  const viaBrowser = await deflateBase64(deltaBytes(d));
  const back2 = deltasOf(nodeInflate(viaBrowser));
  ok(back2 instanceof Float32Array && back2.every((v, i) => Object.is(v, d[i])), "the browser's CompressionStream writes, node's zlib reads it back to the bit");
  ok((await inflateBase64('not base64!')) === null && (await inflateBase64('AAAA')) === null, 'a field that is not base64, or does not inflate, reads as nothing');
  const smooth = deltas((i) => 6 * Math.exp(-(((i % 32) - 16) ** 2 + (Math.floor(i / 32) - 16) ** 2) / 60));
  ok(nodeDeflate(smooth).length < 4000, `a smooth bump filling a tile is ${nodeDeflate(smooth).length} characters`);
}

// The row reader and the backstops.
{
  const good = { id: '1,2', d: nodeDeflate(deltas((i) => (i === 5 ? 1.5 : 0))), on: 'abcdef01', at: 1 };
  ok(typeof readTileRow(good, [], nodeInflate) === 'object', 'a good tile reads');
  ok(typeof readTileRow({ ...good, id: 'x' }) === 'string' && typeof readTileRow({ ...good, on: 'XYZ' }) === 'string' && typeof readTileRow({ ...good, d: '!!' }) === 'string' && typeof readTileRow({ ...good, at: -5 }) === 'string', 'a bad id, digest, base64 or moment is refused');
  const unknown: string[] = [];
  readTileRow({ ...good, extra: 1 }, unknown);
  ok(unknown.join() === '1,2.extra', 'a field this build does not read is named');
  ok(/nought/.test(readTileRow({ ...good, d: nodeDeflate(deltas(() => 0)) }, [], nodeInflate) as string), 'a tile of noughts is no tile');
  ok(/within 4000/.test(readTileRow({ ...good, d: nodeDeflate(deltas((i) => (i === 0 ? 4001 : 0))) }, [], nodeInflate) as string), `a delta past ${HEIGHTS_LIMITS.delta} m is refused`);
  ok(/bytes/.test(readTileRow({ ...good, d: deflateRawSync(Buffer.alloc(100)).toString('base64') }, [], nodeInflate) as string) && HEIGHTS_LIMITS.deltas === 1024, 'a tile is exactly 1,024 deltas');
  ok(/a number of metres/.test(deltasOf(deltaBytes(deltas((i) => (i === 3 ? Number.NaN : 0)))) as string), 'a delta that is not a number is refused');
  ok(HEIGHTS_LIMITS.tiles === 262144, "a file holds at most 262,144 tiles: any world's whole ground");
}

// The file: read whole, refused whole where the header is not this build's, skipped and named a tile at a time.
{
  const rows = [
    { id: '0,0', d: nodeDeflate(deltas((i) => i * 0.001)), on: '00000001', at: 5 },
    { id: '-1,3', d: nodeDeflate(deltas((i) => -i * 0.002)), on: '00000002', at: 6 },
  ];
  const text = heightsFileText('naboo', rows);
  ok(text.split('\n').filter((l) => l.trim().startsWith('{ "id"')).length === 2 && text.indexOf('"-1,3"') < text.indexOf('"0,0"'), 'the writer puts one tile a line, sorted by id');
  const r = readHeightsFile(text, 'naboo', 'ground', nodeInflate);
  ok(!r.problem && r.rows.length === 2 && !r.skipped.length, 'and the reader reads it back whole');
  ok(heightsFileText('naboo', r.rows as never) === text, 'written again from what it read, the same text to the byte');
  ok(/naboo's/.test(readHeightsFile(text, 'tatooine', 'ground').problem ?? ''), "a file whose header names another world is refused whole");
  ok(/later pass/.test(readHeightsFile(text, 'naboo', 'space').problem ?? ''), 'a space zone keeps no heights');
  ok(/poles/.test(readHeightsFile(text.replace('"pole": 2', '"pole": 8'), 'naboo', 'ground').problem ?? ''), "a file of another pole's spacing is refused whole (the copies' 8 m poles)");
  const twice = heightsFileText('naboo', [rows[0], rows[0]]);
  const rt = readHeightsFile(twice, 'naboo', 'ground', nodeInflate);
  ok(rt.rows.length === 1 && rt.skipped.length === 1 && /second tile/.test(rt.skipped[0].why), 'a second tile under one id is skipped and named');
  const { store, skipped } = await storeOfRead(r, inflateBase64);
  ok(store.size === 2 && !skipped.length && Object.is(store.tile(0, 0)![10], Math.fround(0.01)) && Object.is(store.tile(-1, 3)![10], Math.fround(-0.02)), 'a store read whole, every tile inflated by the browser\'s own codec');
}

// Through the endpoint's batch: a nought tile is taken out instead, and the file goes with its last tile.
{
  const ctx = (n: number) => ({ worlds: new Map([['naboo', 'ground' as const]]), now: n, inflate: nodeInflate });
  const a = applyPlacementOp({ op: 'batch', world: 'naboo', edits: [{ file: 'heights', put: { id: '0,0', d: nodeDeflate(deltas((i) => (i === 1 ? 2 : 0))), on: '00000001' } }] }, { story: null, world: null, heights: null }, ctx(10));
  ok(a.status === 200 && a.writes.length === 1, 'a tile put makes the file');
  const text = a.writes[0].text;
  const b = applyPlacementOp({ op: 'batch', world: 'naboo', edits: [{ file: 'heights', delete: '0,0' }] }, { story: null, world: null, heights: text }, ctx(11));
  ok(b.status === 200 && b.writes.length === 1 && b.writes[0].text === null, 'its last tile taken out takes the file away');
}

// The digest: FNV-1a 32 over the float32 heights' bytes, eight hex.
{
  ok(fnv1aHeights(new Float32Array(0)) === '811c9dc5', "the digest of nothing is FNV-1a's offset basis");
  const h = new Float32Array([1, 2, 3]);
  let x = 0x811c9dc5;
  for (const byte of new Uint8Array(h.buffer)) x = Math.imul(x ^ byte, 0x01000193) >>> 0;
  ok(fnv1aHeights(h) === x.toString(16).padStart(8, '0') && fnv1aHeights(new Float32Array([1, 2, 3.0000002])) !== fnv1aHeights(h), "and of heights, FNV-1a over their bytes: a ground that moves under a tile is named");
}

console.log(`\nheightsFile: ${checks} checks passed`);
