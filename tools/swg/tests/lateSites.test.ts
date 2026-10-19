// The no-spawn circles of ours over what SOE's last publishes added to a world's buildout tables
// (tools/swg/spawnpack.mjs `lateSiteCircles`, `addedObjects`, `siteCircles`).
//
// A TEST buildout table in two versions, written as the client writes a datatable and read through the converter's
// own parser over a stand-in mount: only the objects the newer copy added are circled; objects within `LATE_SITE_LINK`
// of each other are one site; a re-issued table with nothing new gives no circle; a table the list did not re-point
// gives none; every circle is marked `src: 'ours'`. Synthetic rows only.
//
// Run: node tools/swg/tests/lateSites.test.ts
import assert from 'node:assert/strict';
import { LATE_SITE_LINK, LATE_SITE_PAD, addedObjects, lateSiteCircles, siteCircles } from '../spawnpack.mjs';
import { chunk, encode, form, W } from './iffWriter.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

/** A datatable (DTII > 0001 > COLS, TYPE, ROWS) as the client writes one; a type beginning f is a float, s a string, else an int. */
function datatable(columns: string[], types: string[], rows: (string | number)[][]): Buffer {
  const cols = new W().i32(columns.length);
  for (const c of columns) cols.str(c);
  const type = new W();
  for (const t of types) type.str(t);
  const body = new W().i32(rows.length);
  rows.forEach((r) => r.forEach((v, i) => (types[i][0] === 'f' ? body.f32(Number(v)) : types[i][0] === 's' ? body.str(String(v)) : body.i32(Number(v)))));
  return Buffer.from(encode(form('DTII', form('0001', chunk('COLS', cols.bytes()), chunk('TYPE', type.bytes()), chunk('ROWS', body.bytes())))));
}
const COLS = ['shared_template_crc', 'cell_index', 'px', 'py', 'pz', 'qw', 'qx', 'qy', 'qz', 'radius', 'portal_layout_crc'];
const TYPES = ['i', 'i', 'f', 'f', 'f', 'f', 'f', 'f', 'f', 'f', 'i'];
const obj = (crc: number, x: number, z: number, cell = 0) => [crc, cell, x, 0, z, 1, 0, 0, 0, 4, 0];
const areas = datatable(['area', 'x1', 'z1', 'x2', 'z2', 'eventRequired'], ['s', 'f', 'f', 'f', 'f', 's'], [['test_1_1', 1000, 2000, 3000, 4000, ''], ['test_1_2', -1000, 0, 0, 1000, ''], ['test_event', 0, 0, 100, 100, 'TEST']]);
const before = datatable(COLS, TYPES, [obj(1, 10, 10), obj(2, 50, 60)]);
// The newer copy keeps both, adds two side by side (one site), one far off (a site of its own) and one in a cell.
const after = datatable(COLS, TYPES, [obj(1, 10, 10), obj(2, 50, 60), obj(3, 500, 500), obj(4, 520, 510), obj(5, 900, 100), obj(6, 1, 1, 2)]);

/** A stand-in mount over the TEST tables: `late` says which paths the list re-pointed, `previous` what the indexes gave. */
function mount(files: Record<string, Buffer>, late: Set<string>, previous: Record<string, Buffer | null>) {
  return {
    has: (p: string) => p in files,
    read: (p: string) => files[p],
    lateOf: (p: string) => late.has(p),
    readIndexed: (p: string) => previous[p] ?? null,
  };
}
const AREAS = 'datatables/buildout/areas_test.iff';
const T11 = 'datatables/buildout/test/test_1_1.iff';
const T12 = 'datatables/buildout/test/test_1_2.iff';

{
  const circles = lateSiteCircles(mount({ [AREAS]: areas, [T11]: after, [T12]: before }, new Set([T11]), { [T11]: before }), 'test');
  ok(circles.length === 2, `only the objects the newer copy added are circled, in two sites (${circles.length})`);
  const big = circles.find((c: { objects: number }) => c.objects === 2);
  ok(!!big && Math.abs(big.x - 1510) < 0.01 && Math.abs(big.z - 2505) < 0.01, `the two side by side are one site about their middle, in the snapshot's frame from the area's corner (${big?.x}, ${big?.z})`);
  ok(!!big && Math.abs(big.r - (Math.hypot(10, 5) + LATE_SITE_PAD)) < 0.05, 'reaching its farthest object plus the pad');
  ok(circles.every((c: { src: string; shape: string; groups: unknown[]; cap: number }) => c.src === 'ours' && c.shape === 'circle' && Array.isArray(c.groups) && c.cap === 0), "every circle is marked ours, in the server's own no-spawn shape");
  ok(!circles.some((c: { x: number; z: number }) => Math.hypot(c.x - 1001, c.z - 2001) < 1), 'an object in a cell is not a site');
}
{
  ok(lateSiteCircles(mount({ [AREAS]: areas, [T11]: before }, new Set([T11]), { [T11]: before }), 'test').length === 0, 'a re-issued table with nothing new gives no circle');
  ok(lateSiteCircles(mount({ [AREAS]: areas, [T11]: after }, new Set(), { [T11]: before }), 'test').length === 0, 'a table the list did not re-point gives none');
  ok(lateSiteCircles(mount({ [AREAS]: areas, [T11]: after }, new Set([T11]), {}), 'test').length === 4, 'a table with no previous copy circles everything it places on its own (four sites)');
  ok(lateSiteCircles({ has: () => false, read: () => Buffer.alloc(0) }, 'test').length === 0, 'a mount with no late phase gives none');
}
{
  const pts = [{ x: 0, z: 0 }, { x: LATE_SITE_LINK, z: 0 }, { x: 2 * LATE_SITE_LINK, z: 0 }, { x: 3 * LATE_SITE_LINK + 1, z: 0 }];
  const c = siteCircles(pts);
  ok(c.length === 2 && c.some((x: { objects: number }) => x.objects === 3), 'clusters merge by single link within the link and no further');
  const added = addedObjects([{ shared_template_crc: 7, cell_index: 0, px: 1, py: 0, pz: 2, qw: 1, qx: 0, qy: 0, qz: 0 }, { shared_template_crc: 7, cell_index: 0, px: 1, py: 0, pz: 2, qw: 0, qx: 0, qy: 1, qz: 0 }], [{ shared_template_crc: 7, cell_index: 0, px: 1, py: 0, pz: 2, qw: 1, qx: 0, qy: 0, qz: 0 }], { x1: 100, z1: 200 });
  ok(added.length === 1 && added[0].x === 101 && added[0].z === 202, 'an object turned another way is a new object; one the old copy had is not');
}

console.log(`\n${passed} checks passed`);
