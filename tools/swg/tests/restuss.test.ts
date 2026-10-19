// Restuss in both of its states, the converter's half (tools/swg/restuss.mjs).
//
// On TEST snapshots of literals -- a world's current copy and an older one holding a TEST city inside the rectangle --
// over a stand-in mount: the addition keeps raw ids but the one that collides, which it moves and counts; it is
// appended after the current copy's nodes, so the first top-level starport (the auto centre) stays the current
// copy's; every added node and child is tagged living; each swapped building gets its ruin on its own place and turn,
// a house none, a block's variant the same for the same id on two runs; the rooms the spawns run reads join a TEST
// indoor row, and that row lands after every other row of the world, tagged living; the ports' tags and the naming
// once per state; `layout.json`'s key order; what `status` asks; a building's travel children carrying its state. The
// hand-overs in the commands themselves (cli.mjs, travel.mjs, soundplaces.mjs) are pinned as text, since every test
// above makes them for itself; and a converted Rori, where there is one (SWG3JS_PACKS or assets-private), is read for
// what each of its files must carry of the city. Then, with the owner's install (skipped without it): the launch
// snapshot's rectangle holds 63 buildings, 659 top-level nodes and 820 with children, no id collides, 35 of them have
// a ruin, and Rori's auto centre with the addition is the Rebel outpost's at 3672, -6421.
//
// Run: node tools/swg/tests/restuss.test.ts
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { placeChildren } from '../travel.mjs';
import { LIVING, RESTUSS_ADD, RESTUSS_KEY, RESTUSS_RUINS, RESTUSS_STATES_VERSION, RUINS, addToSnapshot, layoutObject, namePortsInStates, portTag, restussAddition, restussLast, restussSoundsStatus, restussStatus, ruinOf, statesBlock, tagServerObjects } from '../restuss.mjs';
import { parseSnapshot, flattenWithWorldTransforms } from '../ws.mjs';
import { parseIff } from '../iff.mjs';
import { namePorts } from '../places.mjs';
import { packRow, roomsOf } from '../spawnpack.mjs';
import { loadBuildouts, mergeBuildouts } from '../buildout.mjs';
import { chunk, encode, form, W, type Node } from './iffWriter.ts';
import { PACKS, swgDir } from './materialsHarness.ts';

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

const B = 'object/building/naboo/shared_';
// The current copy: the Rebel outpost's starport first, a rock that holds id 500, and the late camp's pad in the city's circle.
const finalTemplates = ['object/building/military/shared_outpost_starport.iff', 'object/static/shared_rock.iff', 'object/building/naboo/shared_rori_restuss_starport.iff'];
const finalNodes: TNode[] = [
  { id: 10, t: 0, p: [3672, 96, -6421] },
  { id: 500, t: 1, p: [100, 0, 100] },
  { id: 20, t: 2, p: [5281, 70, 6171] },
];
// The older copy: a TEST city inside the rectangle -- its starport with a room and a thing in it, a bank whose id the
// current copy already holds, a house with no ruin, a block of each size -- and something outside it.
const oldTemplates = [`${B}starport_naboo.iff`, 'object/cell/shared_cell.iff', 'object/tangible/terminal/shared_terminal_bank.iff', `${B}bank_naboo.iff`, `${B}filler_building_naboo_style_2.iff`, `${B}filler_nboo_bldg_32x16_style_01.iff`, `${B}filler_nboo_bldg_64x32_s02.iff`, 'object/static/shared_rock.iff'];
const turn: [number, number, number, number] = [Math.cos(0.3), 0, Math.sin(0.3), 0];
const oldNodes: TNode[] = [
  { id: 1000, t: 0, q: turn, p: [5364, 80, 5752], children: [{ id: 1001, containedBy: 1000, t: 1, cell: 2, p: [0, 0, 0], children: [{ id: 1002, containedBy: 1001, t: 2, cell: 2, p: [1, 0, 2] }] }] },
  { id: 500, t: 3, p: [5200, 80, 5600] },
  { id: 1100, t: 4, p: [5100, 80, 5500] },
  { id: 1200, t: 5, p: [5300, 80, 5800] },
  { id: 1300, t: 6, p: [5400, 80, 5900] },
  { id: 1400, t: 7, p: [6000, 80, 6000] },
];
const files: Record<string, Buffer> = {
  'snapshot/rori.ws': snapshot(finalTemplates, finalNodes),
  'datatables/clientregion/rori.iff': datatable(['Name', 'X', 'Z', 'Radius'], ['s', 'f', 'f', 'f'], [['@rori_region_names:narmle', 0, 0, 500], ['@rori_region_names:restuss', 5318, 5680, 325]]),
};
const old = snapshot(oldTemplates, oldNodes);
/** A stand-in mount: the current copy as it reads, the launch copy in `patch_15_02.tre` as `readFrom` reads it. */
const vfs = {
  has: (p: string) => p in files,
  read: (p: string) => files[p],
  versions: (p: string) => (p === 'snapshot/rori.ws' ? [{ archive: 'C:/swg/patch_15_02.tre', size: old.length, deleted: false }, { archive: 'C:/swg/patch_40_client_00.tre', size: files[p].length, deleted: false }] : []),
  readFrom: (p: string, a: string) => {
    if (p === 'snapshot/rori.ws' && a === 'patch_15_02.tre') return old;
    throw new Error(`${p} is not in ${a}`);
  },
  list: () => [],
};

// --- the addition ---------------------------------------------------------------------------------------------------
const snap = parseSnapshot(parseIff(files['snapshot/rori.ws']));
const own = snap.nodes.slice();
const add = restussAddition(vfs, 'rori', own, []);
ok(restussAddition(vfs, 'tatooine', own, []) === null, 'any world but Restuss\'s adds nothing');
ok(add.counts.top === 5 && add.counts.all === 7 && add.counts.buildings === 5, `the rectangle's nodes and their children are taken, and nothing outside it (${add.counts.top} top, ${add.counts.all} in all)`);
const ids = add.nodes.map((n: { id: number }) => n.id);
ok(ids.includes(1000) && ids.includes(1100) && ids.includes(1200) && ids.includes(1300), 'every raw id is kept');
ok(!ids.includes(500) && add.counts.offset === 1 && ids.some((id: number) => id !== 500 && id % (1 << 28) === 500), 'but the one the current copy holds is moved clear of it, and counted');
ok(add.centre.from === 'clientregion' && add.centre.x === 5318 && add.centre.z === 5680, "the city's middle is the client's own region row");
const tagged = (n: { state?: string; children?: unknown[] }): boolean => n.state === LIVING && (n.children ?? []).every((c) => tagged(c as { state?: string; children?: unknown[] }));
ok(add.nodes.every(tagged), 'every added node and every child is tagged living');
ok([...add.cells].length === 1 && add.cells.has(1001), "the city's own cell ids are known");
ok(add.counts.ruins === 4 && add.ruins.length === 4 && add.ruins.every((r: { state: string; children: unknown[] }) => r.state === RUINS && !r.children.length), 'four of the five buildings have a ruin, tagged ruins, with no children');
const starRuin = add.ruins.find((r: { template: string }) => r.template.endsWith('starport_destroyed.iff'));
ok(!!starRuin && starRuin.pos[0] === 5364 && starRuin.pos[2] === 5752 && Math.abs(starRuin.q[0] - turn[0]) < 1e-6 && Math.abs(starRuin.q[2] - turn[2]) < 1e-6, "each ruin stands on its building's own place and turn");
ok(!add.ruins.some((r: { pos: number[] }) => r.pos[0] === 5100), 'the house has no ruin');
const again = restussAddition(vfs, 'rori', own, []);
ok(JSON.stringify(again.ruins.map((r: { template: string }) => r.template)) === JSON.stringify(add.ruins.map((r: { template: string }) => r.template)), "a block's variant is the same for the same id on two runs");
ok(RESTUSS_RUINS[`${B}filler_nboo_bldg_32x16_style_01.iff`].includes(ruinOf(`${B}filler_nboo_bldg_32x16_style_01.iff`, 1200)) && ruinOf(`${B}filler_building_naboo_style_2.iff`, 1100) === null, 'the swap reads off the template names alone');
{
  const refusing = { ...vfs, versions: () => [{ archive: 'patch_40_client_00.tre', size: 1, deleted: false }] };
  assert.throws(() => restussAddition(refusing, 'rori', own, []), /no copy of snapshot\/rori\.ws in patch_15_02\.tre/);
  passed++;
  console.log('ok   with no copy in the launch archive the run refuses in words');
}

// --- appended after the current copy, the auto centre kept -------------------------------------------------------
addToSnapshot(snap, add);
ok(snap.nodes.length === 3 + 5 + 4 && snap.nodes[0].id === 10 && snap.nodes[3].id === 1000, 'the city is appended after the current copy\'s own nodes, its ruins after it');
const entries = flattenWithWorldTransforms(snap);
const firstPort = entries.find((e: { parentId: number; node: { templateIndex: number } }) => e.parentId === 0 && snap.templates[e.node.templateIndex].includes('starport'));
ok(firstPort.node.id === 10 && Math.round(firstPort.world.pos[0]) === 3672 && Math.round(firstPort.world.pos[2]) === -6421, 'so the first top-level starport in entry order, the auto centre, is still the current copy\'s');
const thing = entries.find((e: { node: { id: number } }) => e.node.id === 1002);
ok(thing.node.state === LIVING && thing.parentId === 1001, 'a thing in a room flattens under its cell, tagged living');
ok(snap.restuss && snap.restuss.centre.x === 5318, 'the snapshot carries what the city was read from');

// --- the rooms the spawns run reads, and where the rows they join land -------------------------------------------
{
  const s2 = parseSnapshot(parseIff(files['snapshot/rori.ws']));
  const own2 = s2.nodes.slice();
  const bo = loadBuildouts(vfs, 'rori');
  mergeBuildouts(s2, bo);
  const added = restussAddition(vfs, 'rori', own2, bo.nodes);
  addToSnapshot(s2, added);
  const rooms = roomsOf(s2);
  ok(rooms.has(1001) && rooms.get(1001).cellIndex === 2, "the city's room is one the spawns run finds by the launch snapshot's own cell id");
  const joined = new Map([['test_person', { id: 'test_body', bodies: [] }]]);
  const row = (key: string, cell: number) => ({ key, who: 'test_person', x: 1, y: 0, z: 2, heading: 0, cell, respawn: 300, where: 'cities', from: 'test' });
  const indoor = packRow(row('indoor', 1001), { joined, rooms, pools: new Map() });
  ok(!indoor.lost && indoor.row.room === 2, 'a TEST indoor row there joins its room');
  const lost = packRow(row('indoor', 1001), { joined, rooms: roomsOf(parseSnapshot(parseIff(files['snapshot/rori.ws']))), pools: new Map() });
  ok(lost.lost === 'room', 'and without the city it stands nowhere, as it did before');
  const outA = packRow(row('a', 0), { joined, rooms, pools: new Map() }).row;
  const outB = packRow(row('b', 0), { joined, rooms, pools: new Map() }).row;
  const ordered = restussLast([{ row: outA, cell: 0 }, { row: indoor.row, cell: 1001 }, { row: outB, cell: 0 }], added.cells);
  ok(ordered[0] === outA && ordered[1] === outB && ordered[2].key === indoor.row.key && ordered[2].room === 2, 'and lands after every other row of the world, the rest in their order');
  ok(ordered[2].state === LIVING && !outA.state && !outB.state && !indoor.row.state, "tagged with the living city its room is in (a copy, the row handed over left as it was), so it stands nowhere in the ruins whatever the circle is moved to; the rest untagged");
  ok(restussLast([{ row: outA, cell: 0 }, { row: outB, cell: 0 }], null).length === 2, 'a world with no city keeps its rows as they are');
}

// --- the ports, tagged and named once per state -------------------------------------------------------------------
{
  const centre = { x: 5318, z: 5680 };
  ok(portTag(LIVING, 5364, 5752, centre) === LIVING, "a port of the city's carries its own state");
  ok(portTag(undefined, 5281, 6171, centre) === RUINS, "a port of today's world in the city's circle belongs to the ruins");
  ok(portTag(undefined, 3672, -6421, centre) === undefined && portTag(undefined, 5281, 6171, undefined) === undefined, 'every other port, and every port of a world with no city, stands in both');
  const found = [
    { x: 3672, z: -6421, kind: 'starport', label: 'Narmle Starport' },
    { x: 5364, z: 5752, kind: 'starport', label: 'Restuss Starport', state: LIVING },
    { x: 5211, z: 5791, kind: 'shuttleport', label: 'Restuss Shuttleport', state: LIVING },
    { x: 5281, z: 6171, kind: 'starport', label: 'Restuss Starport', state: RUINS },
    { x: 5240, z: 6205, kind: 'shuttleport', label: 'Restuss Shuttleport', state: RUINS },
  ];
  const named = namePortsInStates(found, (list: typeof found) => namePorts(list, [], new Set()));
  ok(named.names[0] === 'Narmle Starport', 'an untagged port is named alike in both states');
  for (const state of [LIVING, RUINS]) {
    const here = found.map((f, i) => ({ f, n: named.names[i] })).filter((x) => !x.f.state || x.f.state === state).map((x) => x.n);
    ok(new Set(here).size === here.length && here.includes('Restuss Starport') && here.includes('Restuss Shuttleport'), `${state} holds one port of each name`);
  }
  const once = namePortsInStates(found.slice(0, 1), (list: typeof found) => namePorts(list, [], new Set()));
  ok(once.names.length === 1 && once.names[0] === 'Narmle Starport', 'with no port tagged it is the one pass it always was');
  const clash: { x: number; z: number; kind: string; label: string; state?: string }[] = [{ x: 0, z: 0, kind: 'starport', label: 'X Starport' }, { x: 1, z: 0, kind: 'starport', label: 'X Starport', state: LIVING }];
  // A namer that names the untagged port after whatever else is in its pass: two passes, two names.
  const fake = (list: typeof clash) => ({ names: list.map((p) => (p.state ? p.label : `${p.label} beside ${list[list.length - 1].label}`)), fromServer: 0, lettered: 0 });
  assert.throws(() => namePortsInStates([...clash, { x: 2, z: 0, kind: 'starport', label: 'Y', state: RUINS }], fake), /stands in every state and is named/);
  passed++;
  console.log('ok   an untagged port named two ways by two passes stops the run in words');
}

// --- Core3's own objects in the circle, the layout's block and key order, and what status asks -----------------
{
  const s3 = { nodes: [{ id: 1, pos: [5300, 0, 5700], area: 'server:screenplays/cities/rori_restuss.lua' }, { id: 2, pos: [100, 0, 100], area: 'server:x.lua' }, { id: 3, pos: [5300, 0, 5700], buildout: 'rori_7_7' }] } as unknown as { nodes: { state?: string }[] };
  ok(tagServerObjects(s3, { x: 5318, z: 5680 }) === 1 && s3.nodes[0].state === LIVING && !s3.nodes[1].state && !s3.nodes[2].state, "Core3's own objects in the city's circle belong to the living city; the camp's buildouts and anything outside do not");
  const objects = [{ state: LIVING }, { state: LIVING }, { state: RUINS }, {}];
  const block = statesBlock({ archive: 'patch_15_02.tre', rect: RESTUSS_ADD.rect, centre: { x: 5318, z: 5680 } }, objects);
  ok(block[RESTUSS_KEY].living === 2 && block[RESTUSS_KEY].ruins === 1 && block[RESTUSS_KEY].default === 'ruins' && block[RESTUSS_KEY].version === RESTUSS_STATES_VERSION, 'the block counts what each state stands, ruins by default');
  const layout = layoutObject({ planet: 'rori', center: { x: 3672, z: -6421 }, states: block, radius: null, terrain: 'terrain.trn', objects: [], skipped: {} });
  ok(Object.keys(layout).join(',') === 'planet,center,states,radius,terrain,objects,skipped', 'a written layout.json has its states after its centre');
  ok(/^\{"planet":"rori","center":/.test(JSON.stringify(layout)), 'so the centre is still the second key at the head of the file');
  ok(Object.keys(layoutObject({ planet: 'x', center: { x: 0, z: 0 }, radius: 1, terrain: 't', objects: [], skipped: {} })).join(',') === 'planet,center,radius,terrain,objects,skipped', 'and a world with no states writes none');
  ok(restussStatus({ objects: [] }, null, null)?.ask === 'snapshot', "status asks for Rori's snapshot until its layout has the block");
  ok(restussStatus({ states: block }, { pois: [] }, null)?.ask === 'pois', 'its places until they were named by state');
  ok(restussStatus({ states: block }, { states: { restuss: 1 }, pois: [] }, { statics: [] })?.ask === 'spawns', 'its people until they were joined to the city');
  ok(restussStatus({ states: block }, { states: { restuss: 1 } }, { restuss: { joined: 37, version: 1 } }) === null && restussStatus(null, null, null) === null, 'and nothing once all three are, or with no layout');
  ok(restussSoundsStatus({ states: block }, { emitters: [] })?.ask === 'sounds', "its placed sounds, beside them, until they were written with the city read in");
  ok(restussSoundsStatus({ states: block }, { states: { restuss: 1 }, emitters: [] }) === null && restussSoundsStatus({ objects: [] }, { emitters: [] }) === null && restussSoundsStatus({ states: block }, null) === null, 'and never once they were, while the layout has no city (so a mount that cannot read it is not asked for ever), or with no sounds file (the sound places\' own ask)');
}

// --- a building's children carry its state (travel.mjs) --------------------------------------------------------------
{
  const kids = new Map([['object/building/naboo/shared_starport_naboo.iff', [{ kind: 'terminal', x: 1, y: 0, z: 2, yaw: 0, cell: 3 }, { kind: 'collector', x: 4, y: 0, z: 5, yaw: 0, cell: -1 }]]]);
  const placed = placeChildren(
    [
      { template: 'object/building/naboo/shared_starport_naboo.iff', id: 1, x: 5364, y: 80, z: 5752, q: [1, 0, 0, 0], state: LIVING },
      { template: 'object/building/naboo/shared_starport_naboo.iff', id: 2, x: 100, y: 80, z: 100, q: [1, 0, 0, 0] },
    ],
    kids,
  ) as { state?: string; at: number; cell: number }[];
  ok(placed.length === 4 && placed.filter((r) => r.at === 1).every((r) => r.state === LIVING) && placed.filter((r) => r.at === 2).every((r) => r.state === undefined), "a building of the launch city gives every child of its -- in its rooms and out in the open alike -- the living state, and one of every state none");
}

// --- the converter's hand-overs, as the commands write them ------------------------------------------------------------
{
  // Every test above calls restuss.mjs on inputs of its own; these are the lines that hand the city to the commands
  // that write the packs, each of which a deletion would leave both states standing on one another, or the living
  // city's people, ports or sounds lost, with every test above still passing.
  const cli = readFileSync(new URL('../cli.mjs', import.meta.url), 'utf8');
  const travelSrc = readFileSync(new URL('../travel.mjs', import.meta.url), 'utf8');
  const soundSrc = readFileSync(new URL('../soundplaces.mjs', import.meta.url), 'utf8');
  const pin = (src: string, re: RegExp, what: string) => ok(re.test(src), what);
  pin(cli, /const restuss = restussAddition\(vfs, planet, snap\.nodes\.slice\(0, snapshotCount\), buildout\.nodes\);\s*if \(restuss\) \{\s*addToSnapshot\(snap, restuss\);\s*const server = tagServerObjects\(snap, restuss\.centre\);/, "the snapshot and pois read the city in after every other node, and Core3's own objects in its circle with it (loadPlanetObjects)");
  pin(cli, /const pushObject = \(e, obj\) => \{\s*\/\/[^\n]*\n\s*if \(e\.node\.state\) obj\.state = e\.node\.state;/, 'every layout object carries the state its node stands in');
  pin(cli, /const states = snap\.restuss \? statesBlock\(snap\.restuss, objects\) : null;\s*const layout = layoutObject\(\{ planet, center: \{ x: cx, z: cz \}, states,/, "and Rori's layout its `states` block, after its centre");
  pin(cli, /const state = portTag\(e\.node\.state, x, z, snap\.restuss\?\.centre\);/, "each port is tagged by its node's own state, or the ruins' where it stands in the city's circle");
  pin(cli, /const named = namePortsInStates\(found, \(list\) => namePorts\(list, travelPoints, seen\)\);\s*found\.forEach\(\(f, i\) => places\.push\(\{ name: named\.names\[i\], x: f\.x, z: f\.z, r: 0, kind: f\.kind, \.\.\.\(f\.state \? \{ state: f\.state \} : \{\}\) \}\)\);/, 'the ports are named once per state, and each row carries its state');
  pin(cli, /\.\.\.\(snap\.restuss \? \{ states: \{ \[RESTUSS_KEY\]: RESTUSS_STATES_VERSION \} \} : \{\}\), pois \}/, "Rori's places say they were named by state, which `status` asks");
  pin(cli, /addToSnapshot\(snap, restussAddition\(vfs, planet, snap\.nodes\.slice\(\)\)\);\s*const walk = \(node, building\) => \{/, "the fittings' cell cache reads the city in, so a fitting in one of its rooms finds that room (cellIndexById)");
  pin(cli, /byaw: Math\.round\(yawOfLayoutQuat\(building\.q\) \* 1e4\) \/ 1e4,\s*\.\.\.\(building\.state \? \{ state: building\.state \} : \{\}\),/, "and carries its building's state");
  pin(cli, /bx: c\.bx, by: c\.by, bz: c\.bz, byaw: c\.byaw, \.\.\.\(c\.state \? \{ state: c\.state \} : \{\}\) \}\);/, 'onto every fitting row written from it');
  pin(cli, /const added = restussAddition\(spawnVfs, world, own, bo\.nodes\);\s*addToSnapshot\(snap, added\);\s*return \{ rooms: sp\.roomsOf\(snap\), restuss: added \? added\.cells : null \};/, "the spawns run's rooms read the city in too, and know its own cells");
  pin(cli, /const rows = restussLast\(kept, restuss\);/, 'and the rows that join only those rooms go last, tagged living');
  pin(cli, /\.\.\.\(restuss \? \{ restuss: \{ joined: joinedLate, version: RESTUSS_STATES_VERSION \} \} : \{\}\),/, 'which the spawns pack says, for `status`');
  pin(cli, /restussStatus\(layout, pois, readJson\(join\(packDir, 'spawns\.json'\)\)\)/, "`status` asks Rori's snapshot, places and people");
  pin(cli, /restussSoundsStatus\(layout, readJson\(join\(packDir, 'sounds\.json'\)\)\)/, 'and its placed sounds');
  pin(travelSrc, /const state = p\.state \? \{ state: p\.state \} : \{\};/, "travel.mjs takes a building's state for its children");
  ok((travelSrc.match(/\.\.\.state[,\s]/g) ?? []).length >= 2, 'and writes it on a child in a room and one out in the open alike');
  pin(soundSrc, /addToSnapshot\(snap, restussAddition\(vfs, planet, own, buildouts\.nodes\)\);/, "the sounds command reads Rori's placements with the city in them");
  pin(soundSrc, /if \(e\.node\.state\) entry\.state = e\.node\.state;/, 'each emitter carries the state it sounds in');
  pin(soundSrc, /const states = placements\.snap\.restuss \? \{ states: \{ \[RESTUSS_KEY\]: RESTUSS_STATES_VERSION \} \} : \{\};/, 'and the file says the city was read in, which `status` asks');
}

// --- a converted Rori, where there is one --------------------------------------------------------------------------
{
  const rori = join(PACKS, 'rori');
  const read = (file: string): Record<string, unknown> | null => {
    try {
      return JSON.parse(readFileSync(join(rori, file), 'utf8'));
    } catch {
      return null;
    }
  };
  const layout = read('layout.json') as { states?: Record<string, { living: number; ruins: number; centre: { x: number; z: number } }>; objects: { state?: string }[] } | null;
  const block = layout?.states?.[RESTUSS_KEY];
  if (!layout || !block) note("no converted Rori with Restuss's states (npm run swg -- convert assets-private --yes): its packs are not checked");
  else {
    const objects = layout.objects;
    const living = objects.filter((o) => o.state === LIVING).length;
    const ruins = objects.filter((o) => o.state === RUINS).length;
    ok(living === block.living && ruins === block.ruins && living > 0 && ruins === 35, `the layout's objects tagged living and ruins are the block's own counts (${living}, ${ruins})`);
    const firstTagged = objects.findIndex((o) => !!o.state);
    ok(firstTagged > 0 && objects.slice(firstTagged).every((o) => !!o.state), `and every one comes after every object of today's world (the first at ${firstTagged} of ${objects.length})`);
    const pois = read('pois.json') as { states?: Record<string, number>; pois: { name: string; kind: string; state?: string }[] } | null;
    ok(Number(pois?.states?.[RESTUSS_KEY]) >= RESTUSS_STATES_VERSION, 'its places say they were named by state');
    for (const tag of [LIVING, RUINS]) {
      const here = (pois?.pois ?? []).filter((p) => (p.kind === 'starport' || p.kind === 'shuttleport') && (!p.state || p.state === tag));
      const names = here.map((p) => p.name);
      ok(new Set(names).size === names.length && here.filter((p) => p.name === 'Restuss Starport' && p.state === tag).length === 1 && here.filter((p) => p.name === 'Restuss Shuttleport' && p.state === tag).length === 1, `${tag}: one port of each name, Restuss's starport and shuttleport its own state's`);
    }
    const travel = read('travel.json') as { rows: { state?: string }[] } | null;
    const tagged = (travel?.rows ?? []).map((r, i) => (r.state ? i : -1)).filter((i) => i >= 0);
    ok(tagged.length > 0 && (travel?.rows ?? []).every((r) => !r.state || r.state === LIVING) && tagged[0] === (travel?.rows.length ?? 0) - tagged.length, `its travel rows of the launch city carry the living state and come last in the file (${tagged.length} of ${travel?.rows.length})`);
    const fittings = read('fittings.json') as { rows: { state?: string }[] } | null;
    ok((fittings?.rows ?? []).some((r) => r.state === LIVING) && (fittings?.rows ?? []).every((r) => !r.state || r.state === LIVING), 'its fittings in the launch city carry the living state');
    const spawns = read('spawns.json') as { restuss?: { joined: number; version: number }; statics: { state?: string }[] } | null;
    const statics = spawns?.statics ?? [];
    const joined = statics.filter((r) => r.state === LIVING).length;
    ok(!!spawns?.restuss && spawns.restuss.joined > 0 && joined === spawns.restuss.joined && statics.slice(statics.length - joined).every((r) => r.state === LIVING), `its people who join the city's rooms (${spawns?.restuss?.joined}) are tagged living and stand after every other row`);
    const sounds = read('sounds.json') as { states?: Record<string, number>; emitters: { state?: string }[] } | null;
    if (!sounds?.states) note("Rori's placed sounds were written without the city (npm run swg -- sounds @SWG assets-private rori --retail-only): not checked");
    else ok(sounds.emitters.some((e) => e.state === LIVING) && sounds.emitters.every((e) => !e.state || e.state === LIVING), `its placed sounds of the launch city carry the living state (${sounds.emitters.filter((e) => e.state === LIVING).length} of ${sounds.emitters.length})`);
  }
}

// --- the owner's install ---------------------------------------------------------------------------------------------
{
  const swg = swgDir();
  if (!swg) note('no SWG folder (set SWG or name it in .env): the launch city is not counted against an install');
  else {
    const { openVfs } = await import('../tre.mjs');
    const { isRetailByName } = await import('../manifest.mjs');
    const real = openVfs(swg, { filter: (f: string) => isRetailByName(f, statSync(join(swg, f)).size) !== null, log: () => {} });
    const s = parseSnapshot(parseIff(real.read('snapshot/rori.ws')));
    const own4 = s.nodes.slice();
    const bo = loadBuildouts(real, 'rori');
    mergeBuildouts(s, bo);
    const a = restussAddition(real, 'rori', own4, bo.nodes);
    ok(a.counts.buildings === 63 && a.counts.top === 659 && a.counts.all === 820, `the launch snapshot's rectangle holds 63 buildings, 659 top-level nodes and 820 with children (${a.counts.buildings}, ${a.counts.top}, ${a.counts.all})`);
    ok(a.counts.offset === 0, 'no added id collides with the final snapshot or its buildouts');
    ok(a.counts.ruins === 35, `the swap hits exactly 35 of the 63 (${a.counts.ruins})`);
    addToSnapshot(s, a);
    const first = flattenWithWorldTransforms(s).find((e: { parentId: number; node: { templateIndex: number } }) => e.parentId === 0 && s.templates[e.node.templateIndex].includes('starport'));
    ok(Math.round(first.world.pos[0]) === 3672 && Math.round(first.world.pos[2]) === -6421, `Rori's auto centre with the addition is 3672, -6421 (${Math.round(first.world.pos[0])}, ${Math.round(first.world.pos[2])})`);
    real.close();
  }
}

console.log(`\n${passed} checks passed`);
