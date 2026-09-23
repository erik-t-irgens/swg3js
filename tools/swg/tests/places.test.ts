// The client's own named places (`tools/swg/places.mjs`): reading the table, merging it with the
// names we already had, naming a port, and the frame check that says the table is in the snapshot's
// own coordinates rather than assuming it.
//
// Every table below is made up and written here as the client writes one, so nothing of the
// archives is read and the numbers are small enough to check by eye. Each case says what real shape
// of the retail table it stands for.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLIENT_POI_TABLE, PORT_NEAR_M, RING_M, SAME_SPOT_M, frameCheck, mergePlaceLists, placeKey, portLabel, readClientPlaces, title } from '../places.mjs';
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
