// SOE's earlier objects and the holidays' dressing, the converter's half (tools/swg/stateObjects.mjs).
//
// On TEST snapshots of literals over a stand-in mount: the earlier objects are every node an older copy holds that today's
// world has not got, each taken with its subtree from the newest copy holding it, its raw id kept, a thing taken out of a
// room of today's world taken alone into that room's cell; nothing in Restuss's rectangle on Rori is taken; every node is
// tagged `soe=earlier` and appended after everything. The holidays are the event areas' rows, a `server_` area read from the
// client's own `client_` table in its area's frame, each tagged with its holiday and numbered clear of everything; the plain
// reading of the buildouts is what it was. The judge leaves an earlier root out where its box goes into one of today's (or
// a newer earlier one's, or a room's furniture), touching is no overlap, and a root with no box stands. What the layout
// carries (its blocks and its mark), what `status` asks, and the rows that join an added room. The hand-overs in the
// commands (cli.mjs, soundplaces.mjs, buildout.mjs) are pinned as text, since every test above makes them for itself. A
// converted pack, where there is one, is read for what each world must carry; with the owner's install, the worlds the
// archives give added states to are `STATE_OBJECT_WORLDS`.
//
// Run: node tools/swg/tests/stateObjects.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EARLIER, EARLIER_KEY, HOLIDAY_ID_BASE, HOLIDAY_OF_EVENT, OVERLAP_SLACK, OverlapJudge, STATE_OBJECTS_VERSION, STATE_OBJECT_KEYS, STATE_OBJECT_WORLDS, addStateObjects, boxOf, boxesOverlap, droppedOf, earlierAddition, hasStateObjects, holidayAddition, holidayTag, laterJoined, stateObjectBlocks, stateObjectsFor, stateObjectsMark, stateObjectsStatus } from '../stateObjects.mjs';
import { RESTUSS_ADD, layoutObject } from '../restuss.mjs';
import { flattenWithWorldTransforms, parseSnapshot } from '../ws.mjs';
import { parseIff } from '../iff.mjs';
import { loadBuildouts, templateCrc } from '../buildout.mjs';
import { HOLIDAYS } from '../../../src/world/holidays.ts';
import { chunk, encode, form, W, type Node } from './iffWriter.ts';
import { PACKS, swgDir } from './materialsHarness.ts';
import * as THREE from 'three';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const note = (what: string) => console.log(`note ${what}`);

/** One snapshot node as the client writes it: FORM NODE > FORM 0000 > DATA, its children nested after the DATA. */
interface TNode {
  id: number;
  containedBy?: number;
  t: number;
  cell?: number;
  q?: [number, number, number, number];
  p: [number, number, number];
  children?: TNode[];
}
function nodeForm(n: TNode): Node {
  const q = n.q ?? [1, 0, 0, 0];
  const d = new W().i32(n.id).i32(n.containedBy ?? 0).i32(n.t).i32(n.cell ?? 0).f32(q[0]).f32(q[1]).f32(q[2]).f32(q[3]).f32(n.p[0]).f32(n.p[1]).f32(n.p[2]).f32(8).u32(0);
  return form('NODE', form('0000', chunk('DATA', d.bytes()), ...(n.children ?? []).map(nodeForm)));
}
function snapshot(templates: string[], nodes: TNode[]): Buffer {
  const names = new W().i32(templates.length);
  for (const t of templates) names.str(t);
  return Buffer.from(encode(form('WSNP', form('0001', form('NODS', ...nodes.map(nodeForm)), chunk('OTNL', names.bytes())))));
}
/** A datatable (DTII > 0001 > COLS, TYPE, ROWS); a type beginning f is a float, s a string, else an int. */
function datatable(columns: string[], types: string[], rows: (string | number)[][]): Buffer {
  const cols = new W().i32(columns.length);
  for (const c of columns) cols.str(c);
  const type = new W();
  for (const t of types) type.str(t);
  const body = new W().i32(rows.length);
  rows.forEach((r) => r.forEach((v, i) => (types[i][0] === 'f' ? body.f32(Number(v)) : types[i][0] === 's' ? body.str(String(v)) : body.i32(Number(v)))));
  return Buffer.from(encode(form('DTII', form('0001', chunk('COLS', cols.bytes()), chunk('TYPE', type.bytes()), chunk('ROWS', body.bytes())))));
}

// --- the earlier objects --------------------------------------------------------------------------------------------------
const T = ['object/building/test/shared_test_house.iff', 'object/cell/shared_cell.iff', 'object/tangible/furniture/shared_test_chair.iff', 'object/static/shared_test_rock.iff', 'object/static/shared_test_lamp.iff', 'object/static/shared_test_sign.iff', 'object/tangible/furniture/shared_test_table.iff'];
// Today's copy: a house (100) with a room (101) holding a chair (102), and a rock (200).
const finalNodes: TNode[] = [
  { id: 100, t: 0, p: [10, 0, 10], children: [{ id: 101, containedBy: 100, t: 1, cell: 1, p: [0, 0, 0], children: [{ id: 102, containedBy: 101, t: 2, p: [1, 0, 1] }] }] },
  { id: 200, t: 3, p: [50, 0, 50] },
];
// An older copy (patch_10): today's house with a second chair (103) in its room, a house of its own (300 > 301 > 302), the
// lamp (400) at its first place, and a lone cell (600) standing at the top.
const olderNodes: TNode[] = [
  { id: 100, t: 0, p: [10, 0, 10], children: [{ id: 101, containedBy: 100, t: 1, cell: 1, p: [0, 0, 0], children: [{ id: 102, containedBy: 101, t: 2, p: [1, 0, 1] }, { id: 103, containedBy: 101, t: 2, p: [-1, 0, -1] }] }] },
  { id: 300, t: 0, p: [80, 0, 80], children: [{ id: 301, containedBy: 300, t: 1, cell: 1, p: [0, 0, 0], children: [{ id: 302, containedBy: 301, t: 6, p: [0, 0, 1] }] }] },
  { id: 400, t: 4, p: [30, 0, 30] },
  { id: 600, t: 1, p: [0, 0, 0] },
];
// A newer copy (patch_14): the lamp moved, and a sign (500); the house 300 is gone already.
const newerNodes: TNode[] = [
  { id: 100, t: 0, p: [10, 0, 10], children: [{ id: 101, containedBy: 100, t: 1, cell: 1, p: [0, 0, 0], children: [{ id: 102, containedBy: 101, t: 2, p: [1, 0, 1] }] }] },
  { id: 400, t: 4, p: [33, 0, 33] },
  { id: 500, t: 5, p: [70, 0, 70] },
];
const copies: Record<string, Buffer> = { 'patch_10.tre': snapshot(T, olderNodes), 'patch_14.tre': snapshot(T, newerNodes) };
const files: Record<string, Buffer> = { 'snapshot/test_world.ws': snapshot(T, finalNodes) };
const mount = (world: string, fileSet: Record<string, Buffer>, copySet: Record<string, Buffer>, list: string[] = []) => ({
  has: (p: string) => p in fileSet,
  read: (p: string) => fileSet[p],
  // Oldest first, as the real mount answers; the current copy last.
  versions: (p: string) => (p === `snapshot/${world}.ws` ? [...Object.keys(copySet).map((a) => ({ archive: `C:/swg/${a}`, size: copySet[a].length, deleted: false })), { archive: 'C:/swg/patch_50.tre', size: 1, deleted: false }] : []),
  readFrom: (p: string, a: string) => {
    if (p === `snapshot/${world}.ws` && copySet[a]) return copySet[a];
    if (p === `snapshot/${world}.ws` && a === 'patch_50.tre') return fileSet[p];
    throw new Error(`${p} is not in ${a}`);
  },
  list: () => list,
});
const vfs = mount('test_world', files, copies);
const add = earlierAddition(vfs, 'test_world')!;
const roots = add.nodes;
ok(earlierAddition(mount('nowhere', {}, {}), 'nowhere') === null, 'a world with no snapshot has no earlier objects');
ok(roots.map((n: { id: number }) => n.id).join(',') === '400,500,103,300', `the roots come newest copy first, each copy in its own order (${roots.map((n: { id: number }) => n.id).join(',')})`);
const lamp = roots.find((n: { id: number }) => n.id === 400);
ok(lamp.pos[0] === 33 && lamp.from === 'patch_14.tre' && roots.filter((n: { id: number }) => n.id === 400).length === 1, 'the lamp is taken once, from the newest copy holding it, where it last stood');
const house = roots.find((n: { id: number }) => n.id === 300);
ok(house.root === 'top' && house.children.length === 1 && house.children[0].id === 301 && house.children[0].children[0].id === 302 && house.children[0].children[0].containedBy === 301, 'a house of its own comes whole, its room and what the room holds with it, every raw id kept');
const chair = roots.find((n: { id: number }) => n.id === 103);
ok(chair.root === 'inside' && chair.containedBy === 101 && chair.children.length === 0, "a chair taken out of today's room is taken alone, contained by that room's own cell");
const allNodes = (list: { state: string; children: unknown[] }[]): { state: string; template: string; children: unknown[] }[] => list.flatMap((n) => [n as never, ...allNodes(n.children as never)]);
ok(allNodes(roots).every((n) => n.state === EARLIER) && allNodes(roots).every((n) => typeof n.template === 'string' && n.template.startsWith('object/')), 'every node of every root is tagged soe=earlier and carries its template by name');
ok(add.counts.top === 3 && add.counts.inside === 1 && add.counts.strayCells === 1 && add.counts.all === 6 && add.counts.offset === 0 && add.counts.copies === 3, `the counts: three standing alone, one in a room, a lone cell passed over, six nodes, no id moved (${JSON.stringify(add.counts)})`);
// Rori: nothing inside Restuss's rectangle is taken (the city is Restuss's state), even where the launch copy is missing.
{
  const rx = (RESTUSS_ADD.rect[0] + RESTUSS_ADD.rect[2]) / 2;
  const rz = (RESTUSS_ADD.rect[1] + RESTUSS_ADD.rect[3]) / 2;
  const rori = mount('rori', { 'snapshot/rori.ws': snapshot(T, [{ id: 200, t: 3, p: [0, 0, 0] }]) }, { 'patch_10.tre': snapshot(T, [{ id: 700, t: 4, p: [rx, 0, rz] }, { id: 701, t: 4, p: [100, 0, 100] }]) });
  const r = earlierAddition(rori, 'rori')!;
  ok(r.nodes.length === 1 && r.nodes[0].id === 701 && r.counts.restuss === 1, "on Rori, nothing inside Restuss's rectangle is taken: the launch city is Restuss's own state");
}

// A building today's world keeps in its buildout tables, which an older snapshot still held under the table's own ids: a
// chest taken out of its room is contained by the room's own node as today's world numbers it, never by the table's id
// (which no node carries, and which the flattening would answer by standing the chest at its room's local place).
{
  const B = [T[0], T[1], T[2], T[3]];
  const cols = ['objid', 'container', 'shared_template_crc', 'cell_index', 'px', 'py', 'pz', 'qw', 'qx', 'qy', 'qz', 'radius', 'portal_layout_crc'];
  const types = ['i', 'i', 'i', 'i', 'f', 'f', 'f', 'f', 'f', 'f', 'f', 'f', 'i'];
  const bfiles: Record<string, Buffer> = {
    'snapshot/bworld.ws': snapshot(B, [{ id: 200, t: 3, p: [50, 0, 50] }]),
    'datatables/buildout/areas_bworld.iff': datatable(['area', 'x1', 'z1', 'x2', 'z2', 'eventRequired'], ['s', 'f', 'f', 'f', 'f', 's'], [['bworld_1_1', 1000, 2000, 2000, 3000, '']]),
    'datatables/buildout/bworld/bworld_1_1.iff': datatable(cols, types, [
      [5000, 0, templateCrc(B[0]) | 0, 0, 10, 0, 10, 1, 0, 0, 0, 30, 77],
      [5001, 5000, templateCrc(B[1]) | 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    ]),
  };
  // The older copy also holds, in that same room, a thing whose holder (9999) today's world has under no number at all;
  // and a house of its own (8000) whose room's raw id is the buildouts' table id 5000, holding a crate.
  const bcopies: Record<string, Buffer> = {
    'patch_10.tre': snapshot(B, [
      { id: 5000, t: 0, p: [1010, 0, 2010], children: [{ id: 5001, containedBy: 5000, t: 1, cell: 1, p: [0, 0, 0], children: [{ id: 7000, containedBy: 5001, t: 2, p: [2, 0, 3] }, { id: 7001, containedBy: 9999, t: 2, p: [4, 0, 4] }] }] },
      { id: 8000, t: 0, p: [1300, 0, 2300], children: [{ id: 5000, containedBy: 8000, t: 1, cell: 1, p: [0, 0, 0], children: [{ id: 8002, containedBy: 5000, t: 3, p: [1, 0, 1] }] }] },
    ]),
  };
  const bv = mount('bworld', bfiles, bcopies, B);
  const bo = loadBuildouts(bv, 'bworld');
  const cellNode = bo.nodes.find((n: { rawId?: number }) => n.rawId === 5001);
  const b = earlierAddition(bv, 'bworld')!;
  const chest = b.nodes.find((n: { id: number }) => n.id === 7000);
  ok(!!cellNode && !!chest && chest.root === 'inside' && chest.containedBy === cellNode.id && chest.containedBy !== 5001, `a chest taken out of a room of a building today's buildouts keep is contained by that room as today's world numbers it (${chest?.containedBy} for the table's 5001)`);
  ok(!b.nodes.some((n: { id: number }) => n.id === 7001) && b.counts.noHost === 1, `a thing whose holder today's world has under no number is left out, never stood at its room's local place (${b.counts.noHost})`);
  const hall = b.nodes.find((n: { id: number }) => n.id === 8000);
  const room = hall?.children[0];
  ok(!!room && room.id !== 5000 && room.containedBy === 8000 && room.children[0].id === 8002 && room.children[0].containedBy === room.id && b.counts.offset === 1, `an earlier id something of today's world has (a buildout's table id) is moved clear, and what it holds follows it (${room?.id}, its crate held by ${room?.children[0]?.containedBy})`);
  const snap = parseSnapshot(parseIff(bfiles['snapshot/bworld.ws']));
  const { mergeBuildouts } = await import('../buildout.mjs');
  mergeBuildouts(snap, bo);
  addStateObjects(snap, { earlier: b, holidays: null });
  const placed = flattenWithWorldTransforms(snap).find((e: { node: { id: number } }) => e.node.id === 7000);
  ok(!!placed && Math.abs(placed.world.pos[0] - 1012) < 1e-6 && Math.abs(placed.world.pos[2] - 2013) < 1e-6, `and stands in that room, in its building's frame, never about the world's origin (${placed?.world.pos.map((v: number) => v.toFixed(1)).join(', ')})`);
}

// --- the holidays -------------------------------------------------------------------------------------------------------
{
  const H = ['object/static/test/shared_test_pumpkin.iff', 'object/static/test/shared_test_tree.iff', 'object/static/test/shared_test_crate.iff', 'object/building/test/shared_test_hall.iff', 'object/cell/shared_cell.iff'];
  const rowCols = ['shared_template_crc', 'cell_index', 'px', 'py', 'pz', 'qw', 'qx', 'qy', 'qz', 'radius', 'portal_layout_crc'];
  const rowTypes = ['i', 'i', 'f', 'f', 'f', 'f', 'f', 'f', 'f', 'f', 'i'];
  const row = (t: string, x: number, z: number) => [templateCrc(t) | 0, 0, x, 1, z, 1, 0, 0, 0, 4, 0];
  // A Love Day hall in a table of the later shape (its own ids): the hall, its room (the table's 9001) and a crate in it.
  const v2Cols = ['objid', 'container', ...rowCols];
  const v2Types = ['i', 'i', ...rowTypes];
  const hfiles: Record<string, Buffer> = {
    'datatables/buildout/areas_hworld.iff': datatable(['area', 'x1', 'z1', 'x2', 'z2', 'eventRequired'], ['s', 'f', 'f', 'f', 'f', 's'], [
      ['hworld_1_1', 0, 0, 1000, 1000, ''],
      ['server_halloween_town', 2000, -3000, 4000, -1000, 'halloween'],
      ['lifeday_square', 500, 500, 1500, 1500, 'lifeday'],
      ['mystery_fair', 0, 0, 100, 100, 'mystery'],
      ['loveday_hall', 3000, 3000, 3500, 3500, 'loveday'],
      ['hworld_2_2', 1000, 1000, 2000, 2000, ''],
    ]),
    'datatables/buildout/hworld/hworld_1_1.iff': datatable(rowCols, rowTypes, [row(H[2], 10, 10)]),
    'datatables/buildout/hworld/client_halloween_town.iff': datatable(rowCols, rowTypes, [row(H[0], 5, 6), row(H[0], 7, 8)]),
    'datatables/buildout/hworld/lifeday_square.iff': datatable(rowCols, rowTypes, [row(H[1], 1, 1)]),
    'datatables/buildout/hworld/mystery_fair.iff': datatable(rowCols, rowTypes, [row(H[2], 1, 1)]),
    'datatables/buildout/hworld/loveday_hall.iff': datatable(v2Cols, v2Types, [
      [9000, 0, templateCrc(H[3]) | 0, 0, 10, 0, 10, 1, 0, 0, 0, 30, 77],
      [9001, 9000, templateCrc(H[4]) | 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0],
      [9002, 9001, templateCrc(H[2]) | 0, 1, 1, 0, 1, 1, 0, 0, 0, 1, 0],
    ]),
    'datatables/buildout/hworld/hworld_2_2.iff': datatable(rowCols, rowTypes, [row(H[2], 20, 20)]),
  };
  const hv = { ...mount('hworld', hfiles, {}, H), has: (p: string) => p in hfiles };
  const h = holidayAddition(hv, 'hworld');
  const pumpkins = h.nodes.filter((n: { state: string }) => n.state === 'halloween=on');
  ok(pumpkins.length === 2 && pumpkins[0].pos[0] === 2005 && pumpkins[0].pos[2] === -2994 && pumpkins[0].template === H[0], "a server-named area's rows come from the client's own `client_` table beside it, in its area's frame");
  ok(h.nodes.some((n: { state: string; template: string }) => n.state === 'lifeday=on' && n.template === H[1]) && h.counts.halloween === 2 && h.counts.lifeday === 1 && h.counts.loveday === 3 && h.unknown === 1, "each event's rows carry its holiday, and an event no switch stands is counted and left out");
  const plain = loadBuildouts(hv, 'hworld');
  const plainIds = new Set(plain.nodes.map((n: { id: number }) => n.id));
  ok(!h.nodes.some((n: { id: number }) => plainIds.has(n.id)) && h.nodes.every((n: { id: number }) => n.id >= HOLIDAY_ID_BASE) && h.areas.halloween[0] === 'server_halloween_town', "the holidays' ids are none of the plain buildouts' (nor anything under them), and the areas are named as the table names them");
  ok(plain.nodes.length === 2 && plain.nodes.map((n: { id: number }) => n.id).join(',') === `${1 << 30},${(1 << 30) + 1}` && plain.nodes.every((n: { event?: string }) => !n.event), 'the plain reading of the buildouts skips every event area and numbers what is left as it always did');
  // The hall's room: known by the number given here and by the table's own (9001), which Core3's rows name it by.
  const hallCell = h.nodes.find((n: { rawId?: number }) => n.rawId === 9001);
  ok(!!hallCell && h.cells.get(hallCell.id) === 'loveday=on' && h.cells.get(9001) === 'loveday=on' && h.cells.size === 2, `a holiday's room is known by both its numbers, with its holiday (${[...h.cells.keys()].join(', ')})`);
  const hsnap = parseSnapshot(parseIff(snapshot(T, [{ id: 200, t: 3, p: [50, 0, 50] }])));
  addStateObjects(hsnap, { earlier: null, holidays: h });
  ok(hsnap.stateObjects.cells.get(hallCell.id) === 'loveday=on' && hsnap.stateObjects.cells.get(9001) === 'loveday=on', "and a snapshot that takes the holidays in carries the room, for the rows that join it");
  const joined = laterJoined([{ row: { key: 'guest' }, cell: 9001 }, { row: { key: 'other' }, cell: 0 }], hsnap.stateObjects.cells);
  ok(joined.later.length === 1 && joined.later[0].state === 'loveday=on' && joined.kept.length === 1, "so one of Core3's rows naming the hall's room by the table's number joins it, tagged Love Day's");
  const placedHol = flattenWithWorldTransforms(hsnap).find((e: { node: { rawId?: number; templateIndex: number } }) => hsnap.templates[e.node.templateIndex] === H[2] && e.parentId === hallCell.id);
  ok(!!placedHol && Math.abs(placedHol.world.pos[0] - 3011) < 1e-6 && Math.abs(placedHol.world.pos[2] - 3011) < 1e-6, `and the crate in it stands in the hall, in the hall's frame (${placedHol?.world.pos.map((v: number) => v.toFixed(1)).join(', ')})`);
  ok(Object.values(HOLIDAY_OF_EVENT).every((k) => Object.prototype.hasOwnProperty.call(HOLIDAYS, k)) && Object.keys(HOLIDAYS).every((k) => Object.values(HOLIDAY_OF_EVENT).includes(k)), "the converter's holidays are the browser's, key for key");
  ok(STATE_OBJECT_KEYS.join(',') === 'soe,halloween,lifeday,loveday,empireday' && holidayTag('loveday') === 'loveday=on', 'the keys the added states tag with');
}

// --- appending, dropping, and what joins ---------------------------------------------------------------------------------
{
  const snap = parseSnapshot(parseIff(files['snapshot/test_world.ws']));
  const before = snap.nodes.length;
  const added = { earlier: earlierAddition(vfs, 'test_world'), holidays: { nodes: [], cells: new Map(), counts: {}, areas: {}, unknown: 0 } };
  addStateObjects(snap, added, { dropped: new Set([300]) });
  ok(snap.nodes.length === before + 3 && snap.nodes.slice(0, before).every((n: { state?: string }) => !n.state), 'the roots are appended after everything already in the snapshot, nothing before them moved');
  ok(!snap.nodes.some((n: { id: number }) => n.id === 300) && !snap.stateObjects.cells.has(301), 'a dropped root takes its subtree and its rooms with it');
  // With nothing left out, the earlier house's room is carried with its state, which is what the spawns run joins rows by.
  const whole = parseSnapshot(parseIff(files['snapshot/test_world.ws']));
  addStateObjects(whole, { earlier: earlierAddition(vfs, 'test_world'), holidays: null });
  ok(whole.stateObjects.cells.get(301) === EARLIER && whole.stateObjects.cells.size === 1, "a root that stands brings its rooms, each with its state, for the rows that join them");
  const guests = laterJoined([{ row: { key: 'guest' }, cell: 301 }, { row: { key: 'host' }, cell: 101 }], whole.stateObjects.cells);
  ok(guests.later.length === 1 && guests.later[0].key === 'guest' && guests.later[0].state === EARLIER && guests.kept.length === 1 && guests.kept[0].row.key === 'host', "so a row standing in the earlier house's room is joined to it and tagged, and one in today's house is not");
  const legacy = parseSnapshot(parseIff(files['snapshot/test_world.ws']));
  const withHol = { earlier: null, holidays: { nodes: [{ id: HOLIDAY_ID_BASE, containedBy: 0, template: T[3], q: [1, 0, 0, 0], pos: [1, 0, 1], children: [], state: 'halloween=on' }], cells: new Map([[HOLIDAY_ID_BASE + 9, 'halloween=on']]), counts: {}, areas: {}, unknown: 0 } };
  addStateObjects(legacy, withHol, { holidays: false });
  ok(legacy.nodes.length === before && legacy.stateObjects.holidays === 0 && legacy.stateObjects.cells.size === 0, "the legacy `--events` reading takes no holiday's rows or rooms in again (they stand in its plain buildouts)");
  const entries = flattenWithWorldTransforms(snap);
  const c = entries.find((e: { node: { id: number } }) => e.node.id === 103);
  ok(c.parentId === 101 && Math.abs(c.world.pos[0] - 9) < 1e-6 && Math.abs(c.world.pos[2] - 9) < 1e-6, "the chair taken into today's room stands in it, in its building's frame");
  ok(droppedOf({ stateObjects: { dropped: [5, 'x', 7] } }).size === 2 && droppedOf(null).size === 0 && hasStateObjects({ stateObjects: { version: STATE_OBJECTS_VERSION } }) && !hasStateObjects({}), "a layout's own drops and mark, read back");
  const kept = [{ row: { key: 'a' }, cell: 0 }, { row: { key: 'b' }, cell: 301 }, { row: { key: 'c' }, cell: 99 }];
  const j = laterJoined(kept, new Map([[301, EARLIER]]));
  ok(j.kept.length === 2 && j.later.length === 1 && j.later[0].state === EARLIER && j.later[0].key === 'b' && !('state' in kept[1].row), 'a row that joins an added room is taken out, tagged with its state (a copy), and the rest come back as they were');
  ok(laterJoined(kept, null).kept === kept, 'with no added rooms every row comes back as it was');
}

// --- the boxes and the judge ------------------------------------------------------------------------------------------------
{
  const unit = { min: [-1, 0, -1], max: [1, 2, 1] };
  const a = boxOf(unit, [1, 0, 0, 0], [0, 0, 0])!;
  ok(Math.abs(a.c[1] - 1) < 1e-9 && a.e.join(',') === '1,1,1', 'a box stands on its own bounds round its place');
  ok(boxOf({ min: [1, 2, 1], max: [-1, 0, -1] }, [1, 0, 0, 0], [0, 0, 0])!.e.join(',') === '1,1,1', "a pack's box with its larger corner first is read componentwise");
  const mirrored = boxOf({ min: [1, 0, -1], max: [3, 2, 1] }, [1, 0, 0, 0], [10, 0, 0])!;
  ok(Math.abs(mirrored.c[0] - -8) < 1e-9, "the place is mirrored in X as the streamer mirrors it, the bounds (the GLB's own) are not");
  const touching = boxOf(unit, [1, 0, 0, 0], [-2, 0, 0])!;
  ok(!boxesOverlap(boxOf(unit, [1, 0, 0, 0], [0, 0, 0])!, touching), 'two boxes that merely touch are not one inside the other');
  ok(boxesOverlap(boxOf(unit, [1, 0, 0, 0], [0, 0, 0])!, boxOf(unit, [1, 0, 0, 0], [-1.5, 0, 0])!), 'two that go half a metre into each other are');
  const s = Math.SQRT1_2;
  const turned = boxOf({ min: [-3, 0, -0.2], max: [3, 2, 0.2] }, [s, 0, s, 0], [0, 0, 0])!;
  ok(!boxesOverlap(turned, boxOf(unit, [1, 0, 0, 0], [-2.5, 0, 0])!) && boxesOverlap(turned, boxOf(unit, [1, 0, 0, 0], [0, 0, 2.5])!), 'a long thin box turned a quarter is judged by its turned shape, not the square round it');
  ok(!boxesOverlap(boxOf(unit, [1, 0, 0, 0], [0, 0, 0])!, boxOf({ min: [-1, 0, -1], max: [1, 0.01, 1] }, [1, 0, 0, 0], [0, 0, 0])!, OVERLAP_SLACK), 'a box thinner than the slack is a plane and stands inside nothing');
  // A diamond (a unit box turned an eighth) beside a box its square would reach and its own shape does not: its own axes
  // separate them, which the other box's alone cannot.
  const c8 = Math.cos(Math.PI / 8), s8 = Math.sin(Math.PI / 8);
  const diamond = boxOf(unit, [c8, 0, s8, 0], [0, 0, 0])!;
  ok(!boxesOverlap(diamond, boxOf(unit, [1, 0, 0, 0], [-2.3, 0, 2.3])!) && boxesOverlap(diamond, boxOf(unit, [1, 0, 0, 0], [-1.6, 0, 0])!), "a box turned an eighth is judged by its own axes as well as the other's");
  // Turned about no single axis, its own face is the only thing between it and a box standing just past that face: the
  // other box's axes and the edges' crosses all overlap there.
  {
    const tilted = boxOf(unit, [0.9, 0.3, 0.25, 0.2], [0, 0, 0])!;
    const u = tilted.u[0];
    const d = (1 - OVERLAP_SLACK / 2) * (1 + Math.abs(u[0]) + Math.abs(u[1]) + Math.abs(u[2])) + 0.05;
    const past = boxOf(unit, [1, 0, 0, 0], [-(tilted.c[0] + u[0] * d), tilted.c[1] + u[1] * d - 1, tilted.c[2] + u[2] * d])!;
    ok(!boxesOverlap(tilted, past) && boxesOverlap(tilted, boxOf(unit, [1, 0, 0, 0], [-(tilted.c[0] + u[0] * (d - 0.3)), tilted.c[1] + u[1] * (d - 0.3) - 1, tilted.c[2] + u[2] * (d - 0.3)])!), 'a box turned about no single axis is kept apart by its own face, and one 30 cm nearer is inside it');
  }
  // The box is the streamer's own: its middle and its axes where three puts them for the same place and turn.
  {
    const q: [number, number, number, number] = [0.8, 0.2, -0.5, 0.26];
    const pos = [12, 4, -7];
    const b = boxOf({ min: [2, 0, -1], max: [4, 3, 1] }, q, pos)!;
    const n = Math.hypot(...q);
    const tq = new THREE.Quaternion(q[1] / n, -q[2] / n, -q[3] / n, q[0] / n);
    const mid = new THREE.Vector3(3, 1.5, 0).applyQuaternion(tq).add(new THREE.Vector3(-pos[0], pos[1], pos[2]));
    const ax = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)].map((v) => v.applyQuaternion(tq));
    ok(Math.hypot(b.c[0] - mid.x, b.c[1] - mid.y, b.c[2] - mid.z) < 1e-9 && ax.every((v, i) => Math.hypot(b.u[i][0] - v.x, b.u[i][1] - v.y, b.u[i][2] - v.z) < 1e-9), 'a box stands where three stands the same model at the same place and turn');
  }
  const judge = new OverlapJudge();
  judge.placed(boxOf({ min: [-10, 0, -10], max: [10, 10, 10] }, [1, 0, 0, 0], [0, 0, 0]));
  judge.placed(boxOf(unit, [1, 0, 0, 0], [100, 0, 0]), 77);
  ok(judge.judge(boxOf(unit, [1, 0, 0, 0], [5, 0, 5])) === 'today', "an earlier root standing in today's building is left out");
  ok(judge.judge(boxOf(unit, [1, 0, 0, 0], [40, 0, 40])) === null && judge.judge(boxOf(unit, [1, 0, 0, 0], [40.5, 0, 40])) === 'earlier', 'one standing clear stands, and an older one on top of it is left out for the newer');
  ok(judge.judge(boxOf(unit, [1, 0, 0, 0], [100.5, 0, 0]), 77) === 'today' && judge.judge(boxOf(unit, [1, 0, 0, 0], [103, 0, 0]), 77) === null, "one in a room is judged against what stands in that building today, and nothing else");
  ok(judge.judge(boxOf(unit, [1, 0, 0, 0], [5, 0, 5]), 78) === null, "and in another building's room, today's walls round it are not in its way");
  ok(judge.judge(null) === null && judge.counts.noBox === 1, 'a root with no box of its own (a sound, an effect) is in the way of nothing');
}

// --- what the layout carries, and what `status` asks ---------------------------------------------------------------------
{
  const objects = [{ template: 'a' }, { template: 'b', state: 'restuss=living' }, { template: 'c', state: EARLIER }, { template: 'd', state: EARLIER }, { template: 'e', state: 'halloween=on' }];
  const blocks = stateObjectBlocks(objects, { halloween: ['server_halloween_mos_eisley'] });
  ok(Object.keys(blocks).join(',') === 'soe,halloween' && blocks.soe.earlier === 2 && blocks.soe.default === 'final' && blocks.halloween.on === 1 && blocks.halloween.default === 'off' && blocks.halloween.areas[0] === 'server_halloween_mos_eisley', "a block for each added key some object carries, with its values, default and count, and none for Restuss's");
  ok(!Object.keys(stateObjectBlocks([{ template: 'a' }])).length, 'no block where no object carries an added key, so such a world waits on no server');
  const layout = layoutObject({ planet: 'p', center: { x: 1, z: 2 }, states: { restuss: { v: 1 } }, radius: null, terrain: 't', objects: [], skipped: {}, addedStates: blocks, stateObjects: { version: 1, dropped: [] } });
  ok(Object.keys(layout).join(',') === 'planet,center,states,radius,terrain,objects,skipped,stateObjects' && Object.keys(layout.states).join(',') === 'restuss,soe,halloween', "the layout's keys keep their order, the added states after Restuss's, the mark last");
  ok(!('states' in layoutObject({ planet: 'p', center: { x: 0, z: 0 }, radius: null, terrain: 't', objects: [], skipped: {}, addedStates: {} })), 'a world with no states has no states block');
  const mark = stateObjectsMark({ earlier: add, holidays: { counts: { halloween: 3 }, areas: { halloween: ['x'] }, unknown: 0 }, dropped: [9, 3], reasons: { today: 1, earlier: 1, inside: 0 }, standing: { soe: 4 } });
  ok(mark.version === STATE_OBJECTS_VERSION && mark.dropped.join(',') === '3,9' && mark.earlier.roots === 4 && mark.holidays.rows.halloween === 3, "the mark says what was taken and what was left out, its ids sorted");
  const L = { stateObjects: { version: STATE_OBJECTS_VERSION, dropped: [] } };
  const cur = { stateObjects: STATE_OBJECTS_VERSION };
  const asks = (files: Record<string, unknown>, layout: unknown = L) => stateObjectsStatus('tatooine', layout, files).map((a: { ask: string }) => a.ask).join(',');
  ok(!stateObjectsStatus('kashyyyk_main', {}, {}).length && !stateObjectsStatus('tatooine', null, {}).length, 'a world the archives give no added state, or no layout, is asked nothing');
  ok(asks({ pois: {}, sounds: {} }, {}) === 'snapshot', 'a world that has them with a layout from before them is asked for its snapshot, and for nothing after it yet');
  ok(asks({ pois: {}, sounds: {}, travel: {}, fittings: {}, spawns: {} }) === 'pois,sounds,travel,fittings,spawns' && asks({ pois: cur, sounds: {}, travel: cur, fittings: {}, spawns: cur }) === 'sounds,fittings', 'then every reader after it written before, together, since none reads another');
  ok(asks({ pois: cur, sounds: cur, travel: cur, fittings: cur, spawns: cur }) === '' && asks({}) === '', 'and nothing once every file there carries the mark (a file that is not there is its own ask)');
}

// --- the converter's hand-overs, as the commands write them ---------------------------------------------------------------
{
  const cli = readFileSync(new URL('../cli.mjs', import.meta.url), 'utf8');
  const sounds = readFileSync(new URL('../soundplaces.mjs', import.meta.url), 'utf8');
  const bo = readFileSync(new URL('../buildout.mjs', import.meta.url), 'utf8');
  const pin = (src: string, re: RegExp, what: string) => ok(re.test(src), what);
  pin(cli, /if \(stateObjects !== 'none'\) \{\s*const added = stateObjectsFor\(vfs, planet\);\s*addStateObjects\(snap, added, \{ dropped: stateObjects === 'all' \? null : droppedOf\(stateObjects\), holidays: !flags\.has\('--events'\) \}\);/, 'the snapshot and the places read the added states in after Restuss, as a layout left them or all of them (loadPlanetObjects)');
  pin(cli, /loadPlanetObjects\(vfs, planet, \{ stateObjects: 'all' \}\)/, 'the snapshot reads every one of them, and decides');
  pin(cli, /if \(added === EARLIER_KEY && e\.node\.root\) \{\s*const why = judge\.judge\(box, e\.node\.root === 'inside' \? buildingOf\(e\) : null\);/, 'each earlier root is judged as it is placed');
  pin(cli, /\} else if \(!added\) judge\.placed\(box, obj\.contained \? buildingOf\(e\) : null\);/, "and every object of today's world handed to the judge as it is placed");
  pin(cli, /if \(droppedIds\.has\(e\.parentId\)\) \{\s*droppedIds\.add\(n\.id\);\s*continue;\s*\}/, 'what a dropped root held goes with it');
  pin(cli, /if \(!obj\.contained && addedKeyOf\(n\)\) \{/, 'an added object lays no terrain layer');
  pin(cli, /layoutObject\(\{ planet, center: \{ x: cx, z: cz \}, states, radius: Number\.isFinite\(radius\) \? radius : null, terrain: terrainFile, objects, skipped, \.\.\.stateObjectsOfLayout\(\) \}\)/, "the layout carries the added states' blocks and the mark");
  pin(cli, /writePois\(vfs, planet, snap, droppedIds\.size \? entries\.filter\(\(e\) => !droppedIds\.has\(e\.node\.id\)\) : entries, cx, cz, outDir\);/, 'the places leave out a dropped root');
  pin(cli, /\.\.\.\(snap\.stateObjects \? \{ stateObjects: STATE_OBJECTS_VERSION \} : \{\}\), \.\.\.\(snap\.restuss \?/, 'the places say the added states were read in');
  pin(cli, /loadPlanetObjects\(vfs, planet, \{ stateObjects: hasStateObjects\(had\) \? had : 'none' \}\)/, 'the places command reads them as the layout left them');
  pin(cli, /if \(hasStateObjects\(layout\)\) addStateObjects\(snap, stateObjectsFor\(vfs, planet\), \{ dropped: droppedOf\(layout\) \}\);\s*const walk = \(node, building\) => \{/, "the fittings' cell cache reads them in as the layout left them (cellIndexById)");
  pin(cli, /const cells = cellIndexById\(vfs, planet, layout\);/, 'and is handed the layout');
  pin(cli, /if \(stated\) addStateObjects\(snap, stateObjectsFor\(spawnVfs, world\), \{ dropped: droppedOf\(layout\) \}\);/, "the spawns run's rooms read them in too");
  pin(cli, /return \{ rooms: sp\.roomsOf\(snap\), restuss: added \? added\.cells : null, later: stated \? snap\.stateObjects\.cells : null, stated \};/, "and hand on the rooms the appending found, less what the layout left out, to join the rows by");
  pin(cli, /const \{ rooms, restuss, later: laterCells, stated \} = roomsOf\(world\);/, 'which the rows are joined by');
  pin(cli, /const \{ kept, later \} = laterJoined\(packed, laterCells\);\s*[\s\S]{0,400}?const rows = restussLast\(kept, restuss\);\s*rows\.push\(\.\.\.later\);/, "and the rows that join their rooms go after every other row, Restuss's included");
  pin(cli, /\.\.\.\(stated \? \{ stateObjects: STATE_OBJECTS_VERSION, laterJoined: later\.length \} : \{\}\),/, 'which the spawns pack says');
  pin(cli, /\.\.\.\(hasStateObjects\(layout\) \? \{ stateObjects: STATE_OBJECTS_VERSION \} : \{\}\), \.\.\.\(ngeLeftOut \? \{ nge: 'none' \} : \{\}\), counts, rigs: used, rows \}/, 'the travel file says it was written from such a layout');
  pin(cli, /\.\.\.\(hasStateObjects\(layout\) \? \{ stateObjects: STATE_OBJECTS_VERSION \} : \{\}\), counts, rows, cloning \}/, 'and the fittings file');
  pin(cli, /const stateAsks = stateObjectsStatus\(planet, layout, \{ pois, sounds: readJson\(join\(packDir, 'sounds\.json'\)\), travel, fittings, spawns: readJson\(join\(packDir, 'spawns\.json'\)\) \}\);\s*for \(const stateAsk of stateAsks\) \{/, '`status` asks what each world still needs');
  pin(cli, /else if \(stateSounds\.length\) need\(`sounds <swg-dir> \$\{dir\} all --retail-only`/, 'and the sounds of several worlds in one run over every planet');
  pin(sounds, /if \(hasStateObjects\(layout\)\) addStateObjects\(snap, stateObjectsFor\(vfs, planet\), \{ dropped: droppedOf\(layout\) \}\);/, 'the sounds command reads them in as the layout left them');
  pin(sounds, /const placements = loadPlacements\(vfs, planet, log, layout\);/, 'and is handed the layout');
  pin(sounds, /const added = placements\.snap\.stateObjects \? \{ stateObjects: STATE_OBJECTS_VERSION \} : \{\};/, 'and the file says so');
  pin(bo, /if \(eventsOnly && !area\.eventRequired\) return;/, "the events-only reading leaves out every plain area before it numbers anything");
  pin(bo, /if \(!rows && eventsOnly && name\.startsWith\('server_'\)\) rows = table\(vfs, `datatables\/buildout\/\$\{planet\}\/client_\$\{name\.slice\('server_'\.length\)\}\.iff`\);/, "and reads a server-named area from the client's own table");
}

// --- the converted packs, where there are any ------------------------------------------------------------------------------
{
  let seen = 0;
  for (const world of STATE_OBJECT_WORLDS) {
    const f = join(PACKS, world, 'layout.json');
    if (!existsSync(f)) continue;
    const layout = JSON.parse(readFileSync(f, 'utf8'));
    if (!hasStateObjects(layout)) {
      note(`${world}'s layout was converted before the added states (npm run swg -- snapshot @SWG ${world} assets-private/${world} --center=auto --radius=all --retail-only): not checked`);
      continue;
    }
    seen++;
    const added = (o: { state?: string }) => STATE_OBJECT_KEYS.includes(String(o.state ?? '').split('=')[0]);
    const first = layout.objects.findIndex(added);
    ok(first < 0 || layout.objects.slice(first).every(added), `${world}: every added object comes after every object of today's world and Restuss's`);
    ok(!layout.objects.some((o: { state?: string; layer?: string }) => added(o) && o.layer), `${world}: no added object lays a terrain layer`);
    const inRoom = layout.objects.filter((o: { state?: string; contained?: boolean }) => added(o) && o.contained);
    ok(inRoom.every((o: { in?: number; cell?: number }) => typeof o.in === 'number' && typeof o.cell === 'number'), `${world}: every one of its ${inRoom.length} added things in a room names its building and room (none stands about the world's origin)`);
    for (const [key, block] of Object.entries(layout.states ?? {}) as [string, { earlier?: number; on?: number }][]) {
      if (!STATE_OBJECT_KEYS.includes(key)) continue;
      const n = layout.objects.filter((o: { state?: string }) => String(o.state ?? '').startsWith(`${key}=`)).length;
      ok(n === (block.earlier ?? block.on), `${world}: the ${key} block's count is the layout's own (${n})`);
    }
    for (const [file, field] of [['pois.json', 'pois'], ['sounds.json', 'emitters'], ['travel.json', 'rows'], ['fittings.json', 'rows'], ['spawns.json', 'statics']]) {
      const p = join(PACKS, world, file);
      if (!existsSync(p)) continue;
      const doc = JSON.parse(readFileSync(p, 'utf8'));
      if (!(Number(doc.stateObjects) >= STATE_OBJECTS_VERSION)) {
        note(`${world}'s ${file} was written before the added states: not checked`);
        continue;
      }
      const rows = doc[field] ?? [];
      ok(rows.every((r: { state?: string }) => !r.state || /^(restuss|soe|halloween|lifeday|loveday|empireday)=/.test(r.state)), `${world}'s ${file}: every row is untagged or of a world state this build knows`);
      if (file === 'spawns.json') {
        const firstLater = rows.findIndex(added);
        ok(firstLater < 0 || (rows.slice(firstLater).every(added) && Number(doc.laterJoined) === rows.length - firstLater), `${world}'s people who join an added room stand last, tagged, and the file counts them (${doc.laterJoined})`);
      }
    }
  }
  if (!seen) note('no converted pack carries the added states yet: nothing on disk checked');
}

// --- the owner's install --------------------------------------------------------------------------------------------------
{
  const swg = swgDir();
  if (!swg) note('no SWG folder (set SWG or name it in .env): the worlds with added states are not counted against an install');
  else {
    const { openVfs } = await import('../tre.mjs');
    const { isRetailByName } = await import('../manifest.mjs');
    const real = openVfs(swg, { filter: (f: string) => isRetailByName(f, statSync(join(swg, f)).size) !== null, log: () => {} });
    const worlds = real.list('snapshot/').filter((p: string) => p.endsWith('.ws')).map((p: string) => p.split('/').pop()!.replace('.ws', ''));
    const areas = real.list('datatables/buildout/').filter((p: string) => /areas_[^/]+\.iff$/.test(p)).map((p: string) => p.split('/').pop()!.replace(/^areas_/, '').replace(/\.iff$/, ''));
    const withAdded: string[] = [];
    for (const w of [...new Set([...worlds, ...areas])].sort()) {
      const a = stateObjectsFor(real, w);
      if ((a.earlier?.nodes.length ?? 0) + a.holidays.nodes.length) withAdded.push(w);
    }
    ok(withAdded.join(',') === [...STATE_OBJECT_WORLDS].sort().join(','), `the worlds the archives give earlier objects or a holiday's rows are STATE_OBJECT_WORLDS (${withAdded.join(', ')})`);
    const t = stateObjectsFor(real, 'tatooine');
    ok(t.holidays.counts.halloween === 351 && t.holidays.counts.lifeday === 39 && t.earlier.counts.offset === 0, `Tatooine's Halloween is 351 rows and Life Day's 39, and no earlier id collides (${JSON.stringify(t.holidays.counts)})`);
    const n = stateObjectsFor(real, 'naboo');
    ok(n.holidays.counts.halloween === 287, `Moenia's Halloween is 287 rows (${n.holidays.counts.halloween})`);
    const r = stateObjectsFor(real, 'rori');
    ok(r.earlier.counts.restuss > 0 && r.earlier.nodes.every((x: { pos: number[] }) => !(x.pos[0] >= 5050 && x.pos[0] <= 5540 && x.pos[2] >= 5470 && x.pos[2] <= 5915)), `Rori's earlier objects leave Restuss's rectangle to the city (${r.earlier.counts.restuss} there)`);
  }
}

console.log(`\n${passed} checks passed`);
