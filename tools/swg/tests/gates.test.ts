// The gates between one world's zones: the join the converter writes (tools/swg/gates.mjs) and the
// rule the game presses the key by (src/world/zoneGates.ts).
//
// The join is checked through a fake archive rather than the owner's own, so it runs anywhere: a
// named-places table with the same shape the client's has, including the row that names its
// description's string where its name's belongs, and a buildout areas table of two instances.
//
// The rule is checked case by case, and the two that matter most are the ones that are ours: a gate
// never takes the key from a lift, a building or a vehicle in reach, and it is not offered at all
// within a few seconds of a blow, which is what keeps a fight beside a gate from ending in another
// zone by accident.

import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { form, chunk, W, encode } from './iffWriter.ts';
import {
  AREA_ZONES, GATES_FORMAT, GATE_MATCH_MAX, PLACE_ZONES, ZONE_NAMES, areaAt, gateLines, isZoneGate, joinGates, placeNames, readAreas, readNamedPlaces, writeZoneGates, zoneLabel,
} from '../gates.mjs';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`);
  if (!ok) failures++;
};

// --- a fake archive ---------------------------------------------------------------------------

/** A datatable, written the way the client's are. */
const dt = (cols: string[], types: string[], rows: W[]) =>
  Buffer.from(encode(form('DTII', form('0001',
    chunk('COLS', cols.reduce((w, c) => w.str(c), new W().i32(cols.length)).bytes()),
    chunk('TYPE', types.reduce((w, t) => w.str(t), new W()).bytes()),
    chunk('ROWS', new Uint8Array([...new W().i32(rows.length).bytes(), ...rows.flatMap((r) => [...r.bytes()])]))))));

/** A string table: the header, the texts in UTF-16, then the names that index them. */
function stf(entries: [string, string][]): Buffer {
  const head = new W().u32(0xabcd).u8(1).u32(entries.length + 1).u32(entries.length);
  for (let i = 0; i < entries.length; i++) {
    head.u32(i + 1).u32(0);
    const text = entries[i][1];
    head.u32(text.length);
    for (const ch of text) head.u16(ch.charCodeAt(0));
  }
  for (let i = 0; i < entries.length; i++) {
    head.u32(i + 1).u32(entries[i][0].length);
    for (const ch of entries[i][0]) head.u8(ch.charCodeAt(0));
  }
  return Buffer.from(head.bytes());
}

const placeCols = ['Name', 'Description', 'Planet', 'Appearance', 'X', 'Y', 'Z'];
const placeTypes = ['s', 's', 's', 's', 'f', 'f', 'f'];
const place = (id: string, planet: string, x: number, z: number) => new W().str(id).str('').str(planet).str('').f32(x).f32(0).f32(z);

const files = new Map<string, Buffer>([
  ['datatables/clientpoi/clientpoi.iff', dt(placeCols, placeTypes, [
    place('@clientpoi_n:kashyyyk_kachirho', 'kashyyyk_main', -572, -128),
    place('@clientpoi_n:kashyyyk_hunting_grounds', 'kashyyyk_main', 205, -373),
    place('@clientpoi_n:kashyyyk_blackscale_compound', 'kashyyyk_main', 409, 752),
    place('@clientpoi_n:kashyyyk_slave_camp_two', 'kashyyyk_main', 536, 253),
    // The row whose Name cell names the description's string, as one of the client's own does.
    place('@clientpoi_d:kash_etyyy_gate_to_kachirho', 'kashyyyk_hunting', 658, 668),
    place('@clientpoi_n:dead_entrance_kkowir', 'kashyyyk_dead_forest', 83, -444),
  ])],
  ['string/en/clientpoi_n.stf', stf([
    ['kashyyyk_kachirho', 'Kachirho'],
    ['kashyyyk_hunting_grounds', 'Etyyy, Hunting Grounds'],
    ['kashyyyk_blackscale_compound', 'Blackscale Slaver Compound'],
    ['kashyyyk_slave_camp_two', 'Slaver Camp'],
    ['kash_etyyy_gate_to_kachirho', 'Gate to Kachirho Region'],
    ['dead_entrance_kkowir', 'Kkowir Forest Entrance'],
  ])],
  ['string/en/clientpoi_d.stf', stf([['kash_etyyy_gate_to_kachirho', 'This is the gate back to the Kachirho region of Kashyyyk.']])],
  ['datatables/buildout/areas_kashyyyk_north_dungeons.iff', dt(['area', 'x1', 'z1', 'x2', 'z2'], ['s', 'f', 'f', 'f', 'f'], [
    new W().str('slaver').f32(-3840).f32(2816).f32(-2816).f32(3840),
    new W().str('slaver').f32(-2560).f32(2816).f32(-1536).f32(3840),
    new W().str('arena').f32(0).f32(0).f32(1024).f32(1024),
  ])],
]);
const vfs = { has: (p: string) => files.has(p), read: (p: string) => files.get(p)! };

// --- what the archives give -------------------------------------------------------------------

const byPlanet = readNamedPlaces(vfs);
const names = placeNames(byPlanet);
check('the named places come out per world', (byPlanet.get('kashyyyk_main') ?? []).length === 4 && (byPlanet.get('kashyyyk_hunting') ?? []).length === 1);
check('a place keeps its own words', names.get('kashyyyk_kachirho') === 'Kachirho');
check(
  'a row naming its description\'s string still gets its name',
  names.get('kash_etyyy_gate_to_kachirho') === 'Gate to Kachirho Region',
  String(names.get('kash_etyyy_gate_to_kachirho')),
);

const areas = readAreas(vfs, 'kashyyyk_north_dungeons');
check('the areas table reads', areas.length === 3 && areas[0].area === 'slaver');
check('a point lands in its own instance', areaAt(areas, -1998, 2830) === 'slaver' && areaAt(areas, -3278, 2830) === 'slaver');
check('a point in nothing lands in nothing', areaAt(areas, 9000, 9000) === null);
// This restates the rule rather than testing it: the strings are built here to sit either side of
// the pattern, so a looser pattern would pass just the same, and the project does not write a
// model identifier down anywhere a test could hold it against the archives. What really checks the
// rule is the count in `isZoneGate`'s own comment (37 matches over the 32 packs that have a layout,
// no fence, door or wall among them), which is a thing to re-run and not a thing this file can do.
check('a template is a gate only when it is one', isZoneGate('object/building/x/shared_a_zonegate_gate_simple.iff') && !isZoneGate('object/building/x/shared_a_zonegate_fence_simple.iff') && !isZoneGate('object/tangible/door/shared_a_zonegate_door_simple.iff'));

// --- the join ----------------------------------------------------------------------------------

const mainGates = [
  { x: 187.1, y: 18, z: -431 }, // 61 m from the hunting grounds
  { x: 415, y: 17.8, z: 975.2 }, // 223 m from the slaver compound, which is the far pairing
  { x: -572, y: 18, z: -128 }, // standing on the town the zone itself is: no destination
];
const joined = joinGates({ zone: 'kashyyyk_main', gates: mainGates, places: byPlanet.get('kashyyyk_main') ?? [], names });
check('a gate takes the zone its nearest place names', joined[0].to === 'kashyyyk_hunting' && joined[0].label === 'Etyyy, Hunting Grounds', JSON.stringify(joined[0]));
check('the distance it matched on is written down', joined[0].d === 61, String(joined[0].d));
check('a far pairing is still made, and says how far', joined[1].to === 'kashyyyk_north_dungeons' && joined[1].d === 223, JSON.stringify(joined[1]));
check('its destination is named in the archives\' own words', joined[1].label === 'Blackscale Slaver Compound');
check('a place naming the zone the gate stands in is no destination', joined[2].to === null && joined[2].place === 'kashyyyk_kachirho', JSON.stringify(joined[2]));
check('the run prints the distance for every pairing', gateLines('kashyyyk_main', joined).some((l) => l.includes('223 m') && l.includes('FAR')));

const far = joinGates({ zone: 'kashyyyk_main', gates: [{ x: 409 + GATE_MATCH_MAX + 50, y: 0, z: 752 }], places: byPlanet.get('kashyyyk_main') ?? [], names });
check('a place too far off is no match at all', far[0].place === null && far[0].to === null && far[0].d === null);

const hunting = joinGates({ zone: 'kashyyyk_hunting', gates: [{ x: 669.7, y: 8, z: 675.5 }], places: byPlanet.get('kashyyyk_hunting') ?? [], names });
check('the gate the archives describe in words leads where they say', hunting[0].to === 'kashyyyk_main' && hunting[0].label === 'Kachirho', JSON.stringify(hunting[0]));

const instanced = joinGates({
  zone: 'kashyyyk_north_dungeons',
  gates: [{ x: -3278, y: 20, z: 2830 }, { x: -1998, y: 20, z: 2830 }, { x: 500, y: 20, z: 500 }],
  places: [],
  areas,
  names,
});
check('a repeated gate takes its instance\'s way out', instanced[0].to === 'kashyyyk_main' && instanced[1].to === 'kashyyyk_main' && instanced[0].by === 'area', JSON.stringify(instanced[0]));
check('every instance answers the same', instanced[0].label === instanced[1].label && instanced[0].label === 'Kachirho');
check('an instance of another kind is left alone', instanced[2].area === 'arena' && instanced[2].to === null);
const instancedLines = gateLines('kashyyyk_north_dungeons', instanced);
check('the run collapses the repeated ones into one line with a count', instancedLines.filter((l) => l.includes('slaver')).length === 1 && instancedLines.some((l) => l.startsWith('  2 gates')), instancedLines.join(' | '));
check('and still says how many were left unset', instancedLines.some((l) => l.includes('1 of 3 left without a destination')), instancedLines.join(' | '));

check('a pack with no name of its own gets none', zoneLabel('kashyyyk_pob_dungeons', names) === null);
check('the one name of ours is marked as ours', ZONE_NAMES.kashyyyk_south_dungeons.ours === true && ZONE_NAMES.kashyyyk_south_dungeons.text === 'Hracca Glade');

// --- the file the pack carries -------------------------------------------------------------------

const dir = mkdtempSync(join(tmpdir(), 'gates-'));
writeFileSync(join(dir, 'layout.json'), JSON.stringify({
  planet: 'kashyyyk_main',
  center: { x: -670, z: -148 },
  objects: [
    { template: 'object/building/kashyyyk/shared_x_zonegate_gate_simple.iff', x: 187.1, y: 18, z: -431 },
    { template: 'object/building/kashyyyk/shared_x_zonegate_fence_simple.iff', x: 190, y: 18, z: -431 },
  ],
}));
const lines: string[] = [];
const written = writeZoneGates(vfs, 'kashyyyk_main', dir, { log: (s: string) => lines.push(s) });
check('the file is written beside the layout', !!written && existsSync(join(dir, 'gates.json')));
const pack = JSON.parse(readFileSync(join(dir, 'gates.json'), 'utf8'));
check('only the gates go in it', pack.gates.length === 1 && pack.gates[0].to === 'kashyyyk_hunting', JSON.stringify(pack.gates));
check('the centre travels with them', pack.center.x === -670 && pack.center.z === -148);
check('the run says what it did', lines.some((l) => l.includes('Etyyy, Hunting Grounds at 61 m')), lines.join(' | '));

check('the file says which converter wrote it', pack.format === GATES_FORMAT);

const bare = mkdtempSync(join(tmpdir(), 'gates-'));
writeFileSync(join(bare, 'layout.json'), JSON.stringify({ planet: 'tatooine', center: { x: 0, z: 0 }, objects: [{ template: 'object/static/x/shared_rock.iff', x: 0, y: 0, z: 0 }] }));
check('a world with no gates writes no file', writeZoneGates(vfs, 'tatooine', bare, { log: () => {} }) === null && !existsSync(join(bare, 'gates.json')));
check('a pack that was never converted writes nothing', writeZoneGates(vfs, 'lok', join(dir, 'nothing-here'), { log: () => {} }) === null);

// A zone with exactly one buildout area has one rectangle covering the whole world, which tells a
// gate nothing about which instance it stands in: that is the real shape of all three of the open
// zones, so the collapse to no areas at all is driven here rather than left to a rerun.
const oneArea = mkdtempSync(join(tmpdir(), 'gates-'));
writeFileSync(join(oneArea, 'layout.json'), JSON.stringify({
  planet: 'kashyyyk_north_dungeons',
  center: { x: 0, z: 0 },
  objects: [{ template: 'object/building/kashyyyk/shared_x_zonegate_gate_simple.iff', x: -3278, y: 20, z: 2830 }],
}));
const oneAreaFiles = new Map(files);
oneAreaFiles.set('datatables/buildout/areas_kashyyyk_north_dungeons.iff', dt(['area', 'x1', 'z1', 'x2', 'z2'], ['s', 'f', 'f', 'f', 'f'], [
  new W().str('slaver').f32(-8192).f32(-8192).f32(8192).f32(8192),
]));
const oneAreaVfs = { has: (p: string) => oneAreaFiles.has(p), read: (p: string) => oneAreaFiles.get(p)! };
const oneAreaOut = writeZoneGates(oneAreaVfs, 'kashyyyk_north_dungeons', oneArea, { log: () => {} });
check('one area covering the whole zone names no instance, so that gate is left unset', oneAreaOut !== null && oneAreaOut.gates[0].area === null && oneAreaOut.gates[0].to === null, JSON.stringify(oneAreaOut?.gates[0]));

// --- the two tables against the game's own worlds ---------------------------------------------

const { PLANETS } = await import('../../../src/data/planets.ts');
const packs = new Set<string>();
for (const p of PLANETS) for (const z of p.zones ?? []) packs.add(z.pack);
for (const row of PLACE_ZONES) check(`${row.place} names a pack the game has`, packs.has(row.to), row.to);
for (const row of AREA_ZONES) check(`${row.zone}/${row.area} names a pack the game has`, packs.has(row.to) && packs.has(row.zone), `${row.zone} -> ${row.to}`);
for (const row of [...PLACE_ZONES, ...AREA_ZONES]) check(`${row.place ?? row.area} says what it rests on`, typeof row.rests === 'string' && row.rests.length > 10);
for (const key of Object.keys(ZONE_NAMES)) check(`${key} is a pack the game has`, packs.has(key));

// --- the rule the key is pressed by -------------------------------------------------------------

const { GATES_READ, GATE_TUNE, gateAction, gateSaid, gatesInWorld, nearestGate, tuneGates, zoneOfPack, ZoneGates } = await import('../../../src/world/zoneGates.ts');

const world = gatesInWorld({ planet: 'kashyyyk_main', center: { x: -670, z: -148 }, gates: pack.gates });
check('the gates come into the game\'s frame mirrored in X and centred', Math.abs(world[0].x - -(187.1 - -670)) < 1e-6 && Math.abs(world[0].z - (-431 - -148)) < 1e-6, JSON.stringify(world[0]));
check('a missing file is a world with no gates', gatesInWorld(null).length === 0 && gatesInWorld({ planet: 'x', center: { x: 0, z: 0 }, gates: [] }).length === 0);

// The version in the file is read rather than merely written: a pack from a later converter is
// taken as far as this game understands it and the console is told which pack it was.
{
  const said: string[] = [];
  const same = gatesInWorld({ planet: 'kashyyyk_main', format: GATES_FORMAT, center: { x: 0, z: 0 }, gates: pack.gates }, (n) => said.push(n));
  check('a file this game understands is read in silence', same.length === 1 && said.length === 0, said.join(' | '));
  const newer = gatesInWorld({ planet: 'kashyyyk_main', format: GATES_READ + 1, center: { x: 0, z: 0 }, gates: pack.gates }, (n) => said.push(n));
  check('a file from a later converter is read and said so, by name', newer.length === 1 && said.length === 1 && said[0].includes('kashyyyk_main') && said[0].includes('newer converter'), said.join(' | '));
  check('the converter and the game agree on the version today', GATES_FORMAT === GATES_READ);
}

const near = [{ x: 0, y: 0, z: 0, to: 'kashyyyk_main', label: 'Kachirho' }, { x: 0, y: 60, z: 0, to: 'kashyyyk_hunting', label: 'Etyyy, Hunting Grounds' }];
check('the gate in reach is the one you are standing at', nearestGate(near, 1, 1, 1)?.gate.to === 'kashyyyk_main');
check('a gate stacked above you is not the one you are at', nearestGate(near, 0, 55, 0)?.gate.to === 'kashyyyk_hunting');
check('out of reach is no gate', nearestGate(near, 0, 30, 0) === null);

const where = (o: Partial<Parameters<typeof gateAction>[0]> = {}) => gateAction({ live: true, onFoot: true, free: true, since: 99, d: 3, to: true, ...o });
check('standing at a gate, the key goes through it', where() === 'travel');
check('a gate with nowhere to go says so instead', where({ to: false }) === 'nowhere');
check('a blow just struck or taken holds the gate shut', where({ since: GATE_TUNE.calm - 0.1 }) === 'none');
check('and it opens again once the fight is over', where({ since: GATE_TUNE.calm }) === 'travel');
check('anything else that wants the key wins', where({ free: false }) === 'none');
check('riding, at the controls or aboard, the key is not the gate\'s', where({ onFoot: false }) === 'none');
check('a panel, the death card or a load: nothing at all', where({ live: false }) === 'none');
check('too far off is nothing at all', where({ d: GATE_TUNE.reach + 0.1 }) === 'none' && where({ d: null }) === 'none');

const was = { ...GATE_TUNE };
tuneGates({ reach: 40 });
check('the reach is live', where({ d: 30 }) === 'travel');
tuneGates(was);
check('and goes back', where({ d: 30 }) === 'none');

check('where a gate leads is said in the pack\'s own words', gateSaid({ x: 0, y: 0, z: 0, to: 'kashyyyk_main', label: 'Kachirho' }) === 'Kachirho');
check('and a gate the pack names nowhere for still says something', gateSaid({ x: 0, y: 0, z: 0, to: null, label: null }) === 'somewhere this pack does not name' && gateSaid(null) === 'somewhere this pack does not name');

check('a pack id resolves to a world and a zone', zoneOfPack('kashyyyk_hunting')?.zone.id === 'hunting' && zoneOfPack('kashyyyk_hunting')?.planet.id === 'kashyyyk');
check('a pack the game does not have resolves to nothing', zoneOfPack('kashyyyk_atlantis') === null);
for (const row of [...PLACE_ZONES, ...AREA_ZONES]) check(`travel can be asked for ${row.to}`, zoneOfPack(row.to) !== null);

const live = new ZoneGates();
check('a world with nothing loaded has no gate anywhere', live.nearest(0, 0, 0) === null);
check('and is calm', live.since(0) > GATE_TUNE.calm);
live.fought(100);
check('a blow is remembered on the world\'s own clock', live.since(100) === 0 && live.since(102) === 2);
check('a clock that has started again is calm, not a blow in the future', live.since(0) === Number.POSITIVE_INFINITY);
const oneGate = { x: 0, y: 0, z: 0, to: 'kashyyyk_main', label: 'Kachirho' };
const another = { x: 50, y: 0, z: 0, to: 'kashyyyk_hunting', label: 'Etyyy, Hunting Grounds' };
check('where a gate leads is said the first time it is offered', live.fresh(oneGate) === true);
check('and not again while you stand there, nor when you come back to it', live.fresh(oneGate) === false && live.fresh(oneGate) === false);
check('a second gate says itself', live.fresh(another) === true);
check('and nothing at all says nothing', live.fresh(null) === false && live.fresh(undefined) === false);
live.clear();
check('leaving the world forgets it', live.since(100) > GATE_TUNE.calm && live.gates.length === 0);
check('and forgets what was said, since the next world is different places', live.fresh(oneGate) === true);

// --- the gate against the bar the game really fills ------------------------------------------------
//
// The headline claim of all this is that the gate is the *last* thing the key can mean, and it rests
// on two things that live in two files: `gateAction`'s `free`, which the gather works out from what
// else is underfoot, and `push`'s rule in promptRules.ts that two actions never share a binding. So
// both are driven here together, through the game's own fill, rather than each being right alone.

const { PROMPT_WORDS, fillActions, newPromptActions, newPromptState, resetPromptState } = await import('../../../src/ui/promptRules.ts');
const slots = newPromptActions(4);
const stateOf = (fields: Record<string, unknown>) => {
  const s = resetPromptState(newPromptState());
  s.live = true;
  Object.assign(s, fields);
  return s;
};
/** The gather's own rule for `free`, written once here as `App.gatherGate` writes it. */
const freeOf = (s: ReturnType<typeof newPromptState>) => !s.lift && !s.elevator && !s.doorless && !s.near && !s.boots && !s.eva;
/** The whole of it: work the action out as the gather would, fill the bar, and read the words back. */
const barAt = (fields: Record<string, unknown>, d: number | null = 3, to = true): string[] => {
  const s = stateOf(fields);
  const act = gateAction({ live: s.live, onFoot: true, free: freeOf(s), since: 99, d, to });
  s.gate = act === 'none' ? '' : act;
  const n = fillActions(s, slots);
  return slots.slice(0, n).map((a) => `${a.action || `[${a.code}]`} ${a.label}`);
};

check('standing at a gate with nothing else about, the bar offers it', barAt({}).join() === `mount ${PROMPT_WORDS.gate}`, barAt({}).join());
check('a gate the pack names nowhere for says that instead', barAt({}, 3, false).join() === `mount ${PROMPT_WORDS.gateNowhere}`, barAt({}, 3, false).join());
for (const [what, fields, want] of [
  ['a lift shaft', { lift: true }, PROMPT_WORDS.lift],
  ['an elevator', { elevator: 'up' }, PROMPT_WORDS.up],
  ['a building with no way in', { doorless: true }, PROMPT_WORDS.inside],
  ['a speeder in reach', { near: 'mount' }, PROMPT_WORDS.mount],
  ['a ship with a room in reach', { near: 'board' }, PROMPT_WORDS.board],
] as [string, Record<string, unknown>, string][]) {
  const got = barAt(fields);
  check(`${what} keeps the key, and the gate is not offered under it`, got.join() === `mount ${want}`, got.join());
}
check('and none of those leaves the gate on the bar twice', barAt({ lift: true }).every((w) => !w.includes(PROMPT_WORDS.gate)));
// The one thing that does not want this key: the gate stands beside the ship menu, not under it.
check('the ship menu has its own key, so both are shown', barAt({ shipMenu: 'here' }).join() === `mount ${PROMPT_WORDS.gate},ship ${PROMPT_WORDS.shipMenu}`, barAt({ shipMenu: 'here' }).join());
// A blow shuts the gate, whatever the bar would otherwise have said.
{
  const s = stateOf({});
  const act = gateAction({ live: true, onFoot: true, free: freeOf(s), since: GATE_TUNE.calm - 0.1, d: 3, to: true });
  s.gate = act === 'none' ? '' : act;
  check('a blow a moment ago takes the gate off the bar altogether', fillActions(s, slots) === 0);
}
// Every word the gate wears is one of the table's, which is what promptRules.test.ts pins for the
// whole bar; it is said again here because these two are the words this package added.
{
  const table = new Set<string>(Object.values(PROMPT_WORDS));
  check('the gate\'s words come from the one frozen table', table.has(PROMPT_WORDS.gate) && table.has(PROMPT_WORDS.gateNowhere) && !barAt({}).some((w) => w.includes('Kachirho')));
}

console.log(failures ? `${failures} FAILURES` : 'all passed');
process.exit(failures ? 1 : 0);
