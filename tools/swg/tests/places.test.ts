// The client's own named places (`tools/swg/places.mjs`): reading the table, merging it with the
// names we already had, naming a port, and the frame check that says the table is in the snapshot's
// own coordinates rather than assuming it.
//
// Every table below is made up and written here as the client writes one, so nothing of the
// archives is read and the numbers are small enough to check by eye. Each case says what real shape
// of the retail table it stands for.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLIENT_POI_TABLE, PORT_BUILDINGS, PORT_NEAR_M, PORT_ROW_M, RING_M, SAME_SPOT_M, SERVER_POINT_NEAR_M, frameCheck, mergePlaceLists, namePorts, placeKey, portKindOf, portLabel, portsWithoutRow, readClientPlaces, title } from '../places.mjs';
import { chunk, encode, form, W } from './iffWriter.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// ---- the client's own files, written by hand ----

/** A datatable (DTII > 0001 > COLS, TYPE, ROWS) as the client writes one. */
function datatableBytes(columns: string[], types: string[], rows: (string | number)[][]): Buffer {
  const cols = new W().i32(columns.length);
  for (const c of columns) cols.str(c);
  const type = new W();
  for (const t of types) type.str(t);
  const body = new W().i32(rows.length);
  rows.forEach((r) => r.forEach((v, i) => (types[i][0] === 'f' ? body.f32(Number(v)) : types[i][0] === 's' ? body.str(String(v)) : body.i32(Number(v)))));
  return Buffer.from(encode(form('DTII', form('0001', chunk('COLS', cols.bytes()), chunk('TYPE', type.bytes()), chunk('ROWS', body.bytes())))));
}

/** A string table (.stf, version 1) with its entries in the order given. */
function stringTableBytes(entries: [string, string][]): Buffer {
  const b: number[] = [];
  const u32 = (v: number) => b.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255);
  u32(0xabcd);
  b.push(1);
  u32(entries.length + 1);
  u32(entries.length);
  entries.forEach(([, text], i) => {
    u32(i + 1);
    u32(0);
    u32(text.length);
    for (const ch of text) b.push(ch.charCodeAt(0) & 255, ch.charCodeAt(0) >> 8);
  });
  entries.forEach(([name], i) => {
    u32(i + 1);
    u32(name.length);
    for (const ch of name) b.push(ch.charCodeAt(0));
  });
  return Buffer.from(b);
}

// The rows stand for the shapes the retail table really has: an ordinary named row with a
// description of its own; a row whose description repeats its name word for word (10 of the 131
// ground rows, 9 of them on one world); a second row carrying a name an earlier row already carried,
// somewhere else entirely (6 of them); the one row whose Name column names the *description* table
// although the name table holds its key all the same; a name the table wrote with a stray newline
// in it (one retail row does); and — found nowhere in the retail archives, which is why it is
// written here — a row whose key the name table has nothing for at all, which is a missing string
// and not the same fault.
const table = datatableBytes(
  ['Name', 'Description', 'Planet', 'Appearance', 'X', 'Y', 'Z'],
  ['s', 's', 's', 's', 'f', 'f', 'f'],
  [
    ['@clientpoi_n:palace', '@clientpoi_d:palace', 'sand', '', -5856, 0, -6183],
    ['@clientpoi_n:kachirho', '@clientpoi_d:kachirho', 'trees', '', -572, 18, -128],
    ['@clientpoi_n:camp', '@clientpoi_d:camp', 'trees', '', 147, 18, 159],
    ['@clientpoi_n:camp2', '@clientpoi_d:camp2', 'trees', '', 536, 24, 253],
    ['@clientpoi_d:gate_back', '@clientpoi_d:gate_back', 'trees', '', 658, 0, 668],
    ['@clientpoi_n:no_such_string', '@clientpoi_d:camp', 'gap', '', 1, 0, 2],
    ['@clientpoi_n:ragged', '', 'gap', '', 3, 0, 4],
    ['@clientpoi_n:elsewhere', '@clientpoi_d:elsewhere', 'other', '', 0, 0, 0],
  ],
);
const names = stringTableBytes([
  ['palace', "Jabba's Palace"],
  ['kachirho', 'Kachirho'],
  ['camp', 'Slaver Camp'],
  ['camp2', 'Slaver Camp'],
  // The retail shape of the one mislabelled row: its Name column names the description table, and
  // the name table holds its key all the same. Measured over the archives: the name table has a
  // string for all 307 keys, so the column is the fault and the key is the way round it.
  ['gate_back', 'Gate to the First Region'],
  ['elsewhere', 'Somewhere Else'],
  // The tables hold the odd stray newline: one retail row's name ends in one.
  ['ragged', 'Area D-7s1\n'],
]);
const descs = stringTableBytes([
  ['palace', 'The palace of a crime lord.'],
  ['kachirho', 'Kachirho'],
  ['camp', 'A camp.'],
  ['camp2', 'Another camp.'],
  ['gate_back', 'This is the gate back to the first region.'],
  ['elsewhere', 'Another world.'],
]);
const files: Record<string, Buffer> = {
  [CLIENT_POI_TABLE]: table,
  'string/en/clientpoi_n.stf': names,
  'string/en/clientpoi_d.stf': descs,
};
const vfs = { has: (p: string) => p in files, read: (p: string) => files[p] };

// ---- reading the table ----

const sand = readClientPlaces(vfs, 'sand');
ok(sand.rows.length === 1 && sand.rows[0].name === "Jabba's Palace", 'only the planet asked for, named from the name table');
ok(sand.rows[0].kind === 'place' && sand.rows[0].r === 0, 'a place carries no reach of its own, so nothing draws it as a ring');
ok(sand.rows[0].desc === 'The palace of a crime lord.' && sand.rows[0].key === 'palace', "the client's own words, and the row's own key");
ok(!('y' in sand.rows[0]), 'a row whose Y is zero, which is every row of the ten launch worlds, carries no Y into the pack');

const trees = readClientPlaces(vfs, 'trees');
ok(trees.rows.length === 4, 'every row of that planet, repeated names and all');
ok(trees.rows[0].y === 18, "and a row whose Y says something — the two expansion worlds' ground height — keeps it");
ok(trees.rows[0].desc === undefined, 'a description that only repeats the name is not written into the pack');
ok(trees.rows[3].name === 'Gate to the First Region' && trees.unnamed === 1, 'the row whose Name column names the description table is named by its own key, and the run is told the column was wrong');
ok(trees.rows[3].desc === 'This is the gate back to the first region.', 'that row keeps the sentence as what it is: a description');
ok(trees.missing === 0, 'and nothing on that world is labelled from its key: the name table has every one of their keys');
const gap = readClientPlaces(vfs, 'gap');
ok(gap.rows[0].name === 'No Such String' && gap.missing === 1 && gap.unnamed === 0, 'a key the string table has not got is labelled from its key, and counted apart');
ok(gap.rows[1].name === 'Area D-7s1', 'a name the table wrote with a stray newline in it comes out as one line');
ok(readClientPlaces(vfs, 'nowhere').rows.length === 0, 'a planet the table says nothing about gives nothing');
ok(readClientPlaces({ has: () => false, read: () => Buffer.alloc(0) }, 'sand').rows.length === 0, 'archives without the table at all cost the places and nothing else');

// ---- the merge ----

const archive = [
  { name: "Jabba's Palace", x: -5856, z: -6183, r: 0, kind: 'place', desc: 'The palace of a crime lord.' },
  { name: 'Slaver Camp', x: 147, z: 159, r: 0, kind: 'place' },
  { name: 'Slaver Camp', x: 536, z: 253, r: 0, kind: 'place' },
  { name: 'Slaver Camp', x: 147 + SAME_SPOT_M - 1, z: 159, r: 0, kind: 'place' },
  { name: 'Imperial Outpost', x: 10, z: 10, r: 0, kind: 'place' },
  // The shape of the real regression this rule is for: the table's point for a swamp a kilometre
  // across is a thousand metres from the middle our own row draws the ring about.
  { name: 'Agrilat Swamp', x: 1000, z: 0, r: 0, kind: 'place', desc: 'A swamp.' },
  { name: 'Fort Tusken', x: 40, z: 0, r: 0, kind: 'place' },
  { name: 'A Small Thing', x: 900, z: 900, r: 0, kind: 'place' },
];
const ours = [
  { name: 'Imperial Outpost', x: -1785, z: -3087, r: 250, kind: 'city' },
  { name: "jabba's palace", x: -5700, z: -6100, r: 0, kind: 'landmark' },
  { name: 'Bestine', x: -1218, z: -3688, r: 336, kind: 'city' },
  { name: 'Bestine', x: 0, z: 0, r: 0, kind: 'landmark' },
  { name: 'Lars Homestead', x: -2579, z: -5500, r: 0, kind: 'landmark' },
  { name: 'Agrilat Swamp', x: 0, z: 0, r: 1168, kind: 'area' },
  { name: 'Fort Tusken', x: 0, z: 0, r: RING_M, kind: 'landmark' },
  { name: 'A Small Thing', x: 0, z: 0, r: RING_M - 1, kind: 'landmark' },
];
const merged = mergePlaceLists(archive, ours);
const nameOf = (n: string) => merged.places.filter((p) => placeKey(p.name) === placeKey(n));
ok(nameOf("Jabba's Palace").length === 1 && nameOf("Jabba's Palace")[0].kind === 'place', "the client's own row wins a name clash, whatever the case");
ok(nameOf('Lars Homestead').length === 1, 'a name only we have is kept');
ok(nameOf('Slaver Camp').length === 2, 'a name the table repeats somewhere else is kept, as the client drew both');
ok(merged.sameSpot === 1 && nameOf('Slaver Camp').every((p) => p.x !== 147 + SAME_SPOT_M - 1), 'the same name in the same spot is one place, not two');
ok(merged.repeats === 1, 'the run is told how many names the table repeats elsewhere');
const outpost = nameOf('Imperial Outpost');
ok(outpost.length === 1 && outpost[0].kind === 'city' && outpost[0].r === 250, 'a city of ours keeps its row: a city is a ring with a reach and the table carries neither');
ok(nameOf('Bestine').length === 1 && nameOf('Bestine')[0].kind === 'city', 'a name we hold twice ourselves is still dropped the second time, as it always was');

// The exception is not the city's: it is the ring's. A named area or landmark of ours with a reach
// big enough to be drawn as a ring keeps its row for exactly the reason a city does, and the archive
// winning there would have left a bare dot a kilometre from where the ring was.
const swamp = nameOf('Agrilat Swamp');
ok(swamp.length === 1 && swamp[0].kind === 'area' && swamp[0].r === 1168, 'an area of ours with a reach keeps its row, its kind and its ring');
ok(swamp[0].x === 0 && swamp[0].z === 0, 'and keeps where the ring is drawn, rather than moving to the table\'s point inside it');
ok(swamp[0].desc === 'A swamp.', "but takes the client's own words, which is the one thing the archive's row had that ours had not");
const fort = nameOf('Fort Tusken');
ok(fort.length === 1 && fort[0].r === RING_M, `a landmark whose reach is exactly the ring minimum (${RING_M} m) keeps its row too`);
const small = nameOf('A Small Thing');
ok(small.length === 1 && small[0].kind === 'place' && small[0].r === 0, 'a reach too small to be drawn as a ring is a dot either way, so there the archive wins as D14 says');
ok(merged.ringsKept === 3 && merged.clashed === 5, 'the clashes are counted, the rings kept apart');
ok((nameOf("Jabba's Palace")[0] as { desc?: string }).desc === 'The palace of a crime lord.', "and an archive row that wins outright brings its own words with it");

ok(mergePlaceLists([], ours).clashed === 0, 'our own repeats are not clashes: a clash is a name in both sources');
ok(mergePlaceLists([], ours).places.length === 7 && mergePlaceLists(archive, []).places.length === 7, 'either side alone gives its own list');

// `RING_M` is the converter's copy of the number the map draws with, which a converter module cannot
// import. Read the map as text and pin the two together, the way `hudMath.test.ts` pins `hud.css`.
{
  const map = readFileSync(new URL('../../../src/ui/mapUi.ts', import.meta.url), 'utf8');
  const m = /POI_RING_MIN\s*=\s*(\d+)/.exec(map);
  ok(m !== null && Number(m[1]) === RING_M, `the map draws a ring from ${RING_M} m up and the merge keeps our row from the same number (map says ${m?.[1]})`);
}

// ---- naming a port ----

const places = merged.places;
ok(portLabel(-1800, -3100, places, 'Starport').name === 'Imperial Outpost Starport', 'a port inside a city takes the city');
ok(portLabel(-5856 + PORT_NEAR_M - 1, -6183, places, 'Starport').from === 'place', 'no city: the nearest named place within reach');
ok(portLabel(-5856 + PORT_NEAR_M - 1, -6183, places, 'Starport').name === "Jabba's Palace Starport", 'and it is called after it');
ok(portLabel(-5856 + PORT_NEAR_M + 1, -6183, places, 'Starport').from === 'nowhere', 'a place further off than that names nothing');
ok(portLabel(40000, 40000, places, 'Shuttleport').name === 'Shuttleport (40000, 40000)', 'and a port in the middle of nowhere is still named, by where it is');
// A city's own reach wins over a place nearer than it: the city is the bigger truth about a port.
const inTown = [{ name: 'Big Town', x: 0, z: 0, r: 900, kind: 'city' }, { name: 'A Well', x: 50, z: 0, r: 0, kind: 'place' }];
ok(portLabel(60, 0, inTown, 'Starport').name === 'Big Town Starport', "a city holding the port wins over a place a few metres from it");
// Theed's royal hangar, where the city's starport really is: its origin 540 m from the city's own point,
// inside the city's 840 m ring, so it is called what the owner asked for by name.
const theed = [{ name: 'Theed', x: -5320, z: 4368, r: 840, kind: 'city' }];
ok(portLabel(-4795.27, 4238.79, theed, 'Starport').name === 'Theed Starport', "Theed's hangar is Theed Starport, named after the city whose ring holds it");

// ---- which buildings are ports ----

ok(portKindOf('object/building/naboo/shared_hangar_naboo_theed.iff') === 'starport', "Theed's royal hangar is a starport, although its name says neither word");
ok(portKindOf('object/building/naboo/hangar_naboo_theed.iff') === 'starport' && PORT_BUILDINGS.size === 2, "under the server's spelling of its template as well, and it is the one building named so");
ok(portKindOf('object/building/tatooine/shared_starport_tatooine.iff') === 'starport' && portKindOf('object/building/military/shared_outpost_starport.iff') === 'starport', 'a building whose template says starport is a starport, the outposts included');
ok(portKindOf('object/building/naboo/shared_shuttleport_naboo.iff') === 'shuttleport' && portKindOf('object/building/general/shared_shuttleport_general.iff') === 'shuttleport', 'and one that says shuttleport a shuttleport');
ok(portKindOf('object/static/worldbuilding/sign/shared_thm_sign_starport.iff') === null, "a starport's sign is not a starport: only a building is (one took Mos Entha's row 85 m off its port)");
ok(portKindOf('object/building/naboo/shared_hangar_naboo_private.iff') === null && portKindOf('object/building/poi/shared_coa2_rebel_drall_camp.iff') === null, 'nor is any other hangar, nor a camp with a lone shuttle');
ok(portKindOf('') === null && portKindOf(undefined) === null, 'and nothing is nothing');

// ---- naming a town's ports apart ----

{
  // The shape of Theed: three shuttleports that all read "Theed Shuttleport", the server's own points
  // 20 m from each building's origin (where its shuttle lands), and the starport's point 98 m from the
  // hangar, which is a starport and never lends a shuttleport its name.
  const found = [
    { x: -5876.1, z: 4172.2, kind: 'shuttleport', label: 'Theed Shuttleport' },
    { x: -5411.0, z: 4302.3, kind: 'shuttleport', label: 'Theed Shuttleport' },
    { x: -4795.3, z: 4238.8, kind: 'starport', label: 'Theed Starport' },
    { x: -4989.6, z: 4090.9, kind: 'shuttleport', label: 'Theed Shuttleport' },
    { x: 5137.2, z: 6601.6, kind: 'shuttleport', label: 'Kaadara Shuttleport' },
  ];
  const points = [
    { name: 'Theed Shuttle A', x: -5856.1, z: 4172.2, starport: false },
    { name: 'Theed Shuttle B', x: -5005, z: 4072, starport: false },
    { name: 'Theed Shuttle C', x: -5411.0, z: 4322.3, starport: false },
    { name: 'Theed Spaceport', x: -4858.8, z: 4164.1, starport: true },
    { name: 'Kaadara Shuttleport', x: 5123.4, z: 6616.0, starport: false },
  ];
  const named = namePorts(found, points, new Set(['theed']));
  ok(named.names.join('|') === 'Theed Shuttle A|Theed Shuttle C|Theed Starport|Theed Shuttle B|Kaadara Shuttleport', `a town's shuttleports that share a label take the server's own names, each the point beside it (${named.names.join(', ')})`);
  ok(named.fromServer === 3 && named.lettered === 0, 'and the run is told how many the server named');
  ok(named.names[2] === 'Theed Starport', "a port whose label is its own keeps it: the hangar stays Theed Starport, not the server's Theed Spaceport");
  // No point near enough, or none at all: the label and a letter, never a repeat.
  const bare = namePorts(found.slice(0, 2), []);
  ok(bare.names.join('|') === 'Theed Shuttleport A|Theed Shuttleport B' && bare.lettered === 2, 'with no server point near, each takes the label and a letter of ours');
  const far = namePorts(found.slice(0, 2), [{ name: 'Theed Shuttle A', x: -5876.1 + SERVER_POINT_NEAR_M + 1, z: 4172.2, starport: false }]);
  ok(far.names.join('|') === 'Theed Shuttleport A|Theed Shuttleport B', `a point further than ${SERVER_POINT_NEAR_M} m off names nothing`);
  const wrongKind = namePorts(found.slice(0, 2), [{ name: 'Theed Spaceport', x: -5876.1, z: 4172.2, starport: true }]);
  ok(!wrongKind.names.includes('Theed Spaceport'), "a starport's point never names a shuttleport, however near it stands");
  const half = namePorts(found.slice(0, 2), [points[0]]);
  ok(half.names.join('|') === 'Theed Shuttle A|Theed Shuttleport A' && half.fromServer === 1 && half.lettered === 1, 'one the server names and one it does not: the first takes its name, the second a letter');
  const one = namePorts(found.slice(0, 2), [points[0], { name: 'Theed Shuttle A', x: -5411.0, z: 4322.3, starport: false }]);
  ok(new Set(one.names).size === 2, `a name the server gives twice is given once (${one.names.join(', ')})`);
  const clash = namePorts([{ x: 0, z: 0, kind: 'starport', label: 'Big Town Starport' }], [], new Set(['big town starport']));
  ok(clash.names[0] === 'Big Town Starport A', 'a port whose label a place already has is kept under a letter rather than dropped');
  const aPoint = namePorts(found.slice(0, 2), [{ ...points[0], name: 'Theed' }], new Set(['theed']));
  ok(!aPoint.names.includes('Theed'), 'and a server name the place list already holds is not taken');
}

// ---- a port building with no row ----

{
  const objects = [
    { template: 'object/building/tatooine/shared_starport_tatooine.iff', x: 1238.2, z: 3061.9 },
    { template: 'object/static/worldbuilding/sign/shared_thm_sign_starport.iff', x: 1292.3, z: 3127.0 },
    { template: 'object/building/tatooine/shared_shuttleport_tatooine.iff', x: 1730.9, z: 3204.6 },
    { template: 'object/building/tatooine/shared_shuttleport_tatooine.iff', x: 1395.7, z: 3487.0 },
    { template: 'object/building/naboo/shared_hangar_naboo_theed.iff', x: -4795.3, z: 4238.8 },
    { template: 'object/building/tatooine/shared_shuttleport_tatooine.iff', x: 9, z: 9, contained: true },
  ];
  // Mos Entha as a pack written before: the starport's row on the sign, one shuttleport's row, no hangar's.
  const old = [
    { name: 'Mos Entha Starport', kind: 'starport', x: 1292.3, z: 3127.0 },
    { name: 'Mos Entha Shuttleport', kind: 'shuttleport', x: 1730.9, z: 3204.6 },
    { name: 'Mos Entha', kind: 'city', x: 1238.2, z: 3061.9 },
  ];
  const lost = portsWithoutRow(objects, old);
  ok(lost.length === 3 && lost.map((o) => o.kind).join(',') === 'starport,shuttleport,starport', `a pack written before names ${lost.length} port buildings with no row of their own: the starport whose row stood on a sign, the second shuttleport and the hangar`);
  const fresh = [
    { name: 'Mos Entha Starport', kind: 'starport', x: 1238.2, z: 3061.9 },
    { name: 'Mos Entha Shuttle A', kind: 'shuttleport', x: 1730.9, z: 3204.6 },
    { name: 'Mos Entha Shuttle B', kind: 'shuttleport', x: 1395.7 + PORT_ROW_M / 2, z: 3487.0 },
    { name: 'Theed Starport', kind: 'starport', x: -4795.3, z: 4238.8 },
  ];
  ok(portsWithoutRow(objects, fresh).length === 0, 'and one written now names none: every port building has its row at its origin, a building inside another ignored');
  ok(portsWithoutRow(objects, fresh.map((r) => (r.name === 'Theed Starport' ? { ...r, kind: 'shuttleport' } : r))).length === 1, 'a row of the wrong kind is not the building\'s row');
}

// ---- the frame check ----

// Three named places with something built at each of them, and the same three read with X mirrored,
// which on a real planet lands them hundreds of metres from anything. This is the shape of the
// measurement the run prints on every planet.
const built = [{ x: 100, z: 100 }, { x: -400, z: 900 }, { x: 2000, z: -2000 }, { x: 0, z: 0 }];
const rows = [
  { name: 'One', x: 110, z: 100 },
  { name: 'Two', x: -400, z: 940 },
  { name: 'Three', x: 2000, z: -2005 },
];
const fc = frameCheck(rows, built);
ok(fc.rows === 3 && fc.points === 4, 'the check says what it measured over');
ok(fc.asIs === 10 && fc.mirrored > fc.asIs, 'the places sit on what is built where they stand, and not where X is mirrored');
ok(fc.worst !== null && fc.worst.name === 'Two' && fc.worst.m === 40, 'the worst row is named and measured, so a bad one shows in the run');
const mirroredWorld = frameCheck(rows, built.map((p) => ({ x: -p.x, z: p.z })));
ok(mirroredWorld.mirrored !== null && mirroredWorld.asIs !== null && mirroredWorld.mirrored < mirroredWorld.asIs, 'a world whose objects really are mirrored comes out the other way round, which is what the warning watches for');
ok(frameCheck([], built).rows === 0 && frameCheck([], built).worst === null, 'nothing to measure measures nothing');

// ---- the odds and ends ----

ok(title('jabbas_palace') === 'Jabbas Palace' && title('the_great_pit_of_carkoon') === 'The Great Pit of Carkoon', 'a key becomes a label with the small words left small');
ok(placeKey('  Mos Eisley ') === 'mos eisley', 'a name is matched with its case and its edges ignored');

console.log(`\n${checks} checks passed`);
