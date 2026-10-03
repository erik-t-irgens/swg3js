// The instances: the dungeons the game stood a copy of for each group. Two halves, both pure.
//
// The converter's (`tools/swg/instances.mjs`): the corvette's crews and fittings joined to every copy of
// their faction's ship through the copy's own cells, by the room's name; the Star Destroyer's crew of ours
// by room kind; the ticket takers' word for which copy they send a player to; and what `status` asks.
// Checked on rows written by hand, then on the reference the checkout carries (all 268 rows reach a room
// of the corvette, and a known bridge row lands inside the bridge), then on the packs where the owner's
// install has them.
//
// The game's (`src/world/instances.ts`): which copy a group goes to, the ways in and out, the corvette's
// locked rooms and the one rule of what E does there.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  INSTANCES_FORMAT, OUR_CREW, cellIndexByName, copiesIn, corvetteCrewRows, corvetteFactionOf, corvetteFittingRows, corvetteKindOf, corvetteKindRooms, floorTriangles, instanceSpawnsWhy, isStarDestroyerDungeon, ourCrewRows, sdKindOf, takerFaction,
} from '../instances.mjs';
import { packRow, roomsOf } from '../spawnpack.mjs';
import {
  ABOARD, CORVETTE_TEMPLATES, ENTRANCES, INSTANCES, INSTANCE_TUNE, InstanceLocks, aboardOf, besideTaker, copiesOf, copyIndex, corvetteFor, entrancesOf, fallbackBack, instanceOf, instanceOfTemplate, instanceUse, packOfInstance, readWayBack, roomWords, tuneInstances,
} from '../../../src/world/instances.ts';
import { TALK_WORDS, talkOptions } from '../../../src/world/talk.ts';
import { fittingsOf } from '../../../src/world/fittings.ts';
import { COPY_WIRE, cleanUnlock, mayOpen } from '../../../server/copyWire.mjs';
import { emptyGround } from '../../../src/world/terrainTextures.ts';
import { fillActions, newPromptActions, newPromptState, PROMPT_WORDS, PROMPT } from '../../../src/ui/promptRules.ts';

let failures = 0;
const ok = (good: boolean, name: string): void => {
  console.log(`${good ? 'ok  ' : 'FAIL'} ${name}`);
  if (!good) failures++;
};
const note = (s: string): void => console.log(`     ${s}`);

type Raw = { key: string; who: string; x: number; y: number; z: number; heading: number; cell: number; respawn: number; where: string; from: string; ours?: boolean };

// ------------------------------------------------------------------ the converter: rows written by hand
{
  ok(corvetteFactionOf(CORVETTE_TEMPLATES.rebel) === 'rebel' && corvetteFactionOf(CORVETTE_TEMPLATES.imperial) === 'imperial' && corvetteFactionOf(CORVETTE_TEMPLATES.neutral) === 'neutral', 'a corvette copy is the run its template names, nobody\'s where it names none');
  ok(corvetteFactionOf('object/building/tatooine/shared_cantina_tatooine.iff') === null && isStarDestroyerDungeon('object/building/general/shared_space_dungeon_star_destroyer.iff'), 'and anything else is no corvette, while the heroic Star Destroyer is told apart');
  const cells = [
    { index: 0, name: 'r0' },
    { index: 1, name: 'airlock1' },
    { index: 2, name: 'hall2' },
    { index: 3, name: 'bridge66' },
  ];
  const byName = cellIndexByName(cells);
  ok(byName.get('airlock1') === 1 && byName.get('bridge66') === 3 && !byName.has('r0'), 'a room is found by the layout\'s own name, never the outside');

  // Two copies of two runs in a snapshot, flattened, each with its cells under it.
  const templates = [CORVETTE_TEMPLATES.rebel, CORVETTE_TEMPLATES.imperial, 'object/cell/shared_cell.iff'];
  const entries = [
    { node: { id: 100, templateIndex: 0, cellIndex: 0 }, parentId: 0, world: { pos: [1000, 0, 500], q: [1, 0, 0, 0] } },
    { node: { id: 101, templateIndex: 2, cellIndex: 1 }, parentId: 100, world: { pos: [1000, 0, 500], q: [1, 0, 0, 0] } },
    { node: { id: 102, templateIndex: 2, cellIndex: 2 }, parentId: 100, world: { pos: [1000, 0, 500], q: [1, 0, 0, 0] } },
    { node: { id: 103, templateIndex: 2, cellIndex: 3 }, parentId: 100, world: { pos: [1000, 0, 500], q: [1, 0, 0, 0] } },
    // The second copy is turned half round, which its rows must follow.
    { node: { id: 200, templateIndex: 1, cellIndex: 0 }, parentId: 0, world: { pos: [1150, 0, 500], q: [0, 0, 1, 0] } },
    { node: { id: 201, templateIndex: 2, cellIndex: 3 }, parentId: 200, world: { pos: [1150, 0, 500], q: [0, 0, 1, 0] } },
  ];
  const copies = copiesIn(entries, templates, (t: string) => !!corvetteFactionOf(t));
  ok(copies.length === 2 && copies[0].cells.get(3) === 103 && copies[1].cells.get(3) === 201, 'every copy is found with the cell object holding each of its rooms');
  const corvette = {
    rebel: [
      { who: 'novatrooper', x: 5.11, y: 0, z: 146.59, heading: 1.8171, room: 'bridge66' },
      { who: 'novatrooper', x: 1, y: 0, z: 1, heading: 0, room: 'nowhere99' },
    ],
    imperial: [{ who: 'rebel_ensign', x: 1, y: 0, z: 150, heading: 0, room: 'bridge66' }],
    neutral: [],
    statics: [
      { template: 'object/tangible/dungeon/keypad_terminal.iff', x: 1.1, y: 1.2, z: 142.57, heading: Math.PI, room: 'hall2', name: 'Keypad', fn: 'setupKeypad', data: 'bridge66' },
      { template: 'object/tangible/terminal/terminal_geo_bunker.iff', x: 2, y: 0, z: 3, heading: 0, room: 'airlock1', name: 'Escape Pod Controls', fn: 'setupEscapePod' },
      { template: 'object/tangible/dungeon/computer_desktop.iff', x: 4, y: 0.75, z: -1, heading: 0, room: 'hall2', fn: 'setupComputerObject', data: 'nine', faction: 'rebel' },
      { template: 'object/tangible/dungeon/computer_desktop.iff', x: 4, y: 0.75, z: -1, heading: 0, room: 'hall2', fn: 'setupComputerObject', data: 'ten', faction: 'imperial' },
    ],
  };
  const crew = corvetteCrewRows(corvette, copies, byName);
  ok(crew.rows.length === 2 && crew.lost === 1, `each copy takes its own faction's crew, and a row whose room the model has not got is counted lost rather than stood anywhere (${crew.rows.length} stood, ${crew.lost} lost)`);
  ok(crew.rows.every((r: Raw) => r.respawn === 0 && r.where === 'dungeon' && r.from === 'corvette') && new Set(crew.rows.map((r: Raw) => r.key)).size === 2, 'and stays down once killed, as the server stood them, each with a name of its own');
  // A row's name is who it is, where in its room and which room of which copy: never its place in the list.
  // Two of one person in one room, read in both orders, keep their own names (a name off a running count,
  // or off who alone, would swap them).
  const twins = { ...corvette, imperial: [], rebel: [
    { who: 'novatrooper', x: 5.11, y: 0, z: 146.59, heading: 1.8171, room: 'bridge66' },
    { who: 'novatrooper', x: -3, y: 0, z: 140, heading: 0, room: 'bridge66' },
    { who: 'novatrooper', x: 1, y: 0, z: 1, heading: 0, room: 'hall2' },
  ] };
  const ab = corvetteCrewRows(twins, copies, byName).rows as Raw[];
  const ba = corvetteCrewRows({ ...twins, rebel: [...twins.rebel].reverse() }, copies, byName).rows as Raw[];
  const named = (rows: Raw[], x: number) => rows.find((r) => r.x === x && r.who === 'novatrooper')?.key;
  ok(ab.length === 3 && ba.length === 3 && [5.11, -3, 1].every((x) => !!named(ab, x) && named(ab, x) === named(ba, x)) && new Set(ab.map((r) => r.key)).size === 3, 'a row keeps its name whatever order the rows come in, two of one person in one room included');
  // The same person at the same spot in two copies is two names: a server shares a body by its row's name.
  const both = corvetteCrewRows({ rebel: [{ who: 'x', x: 0, y: 0, z: 0, heading: 0, room: 'bridge66' }], imperial: [{ who: 'x', x: 0, y: 0, z: 0, heading: 0, room: 'bridge66' }], neutral: [] }, copies, byName).rows as Raw[];
  ok(both.length === 2 && both[0].key !== both[1].key && both[0].cell !== both[1].cell, 'and one person standing the same spot in two copies is two names, one per copy');
  // Carried out of its room exactly as every indoor row is: through the copy's own turn.
  const rooms = new Map<number, { cellIndex: number; q: number[]; pos: number[] }>([
    [103, { cellIndex: 3, q: [1, 0, 0, 0], pos: [1000, 0, 500] }],
    [201, { cellIndex: 3, q: [0, 0, 1, 0], pos: [1150, 0, 500] }],
  ]);
  const joined = new Map([['novatrooper', { id: 'stormtrooper' }], ['rebel_ensign', { id: 'rebel' }]]);
  const packed = crew.rows.map((r: Raw) => packRow(r, { joined, rooms, pools: new Map() }) as { row?: { x: number; z: number; room: number; local: number[] } });
  const bridge = packed[0].row!;
  ok(bridge.room === 3 && Math.abs(bridge.x - 1005.11) < 1e-6 && Math.abs(bridge.z - 646.59) < 1e-6, `the rebel copy's bridge crewman stands at its own building plus his place in the room (${bridge.x.toFixed(2)}, ${bridge.z.toFixed(2)})`);
  const turned = packed[1].row!;
  ok(Math.abs(turned.x - 1149) < 1e-6 && Math.abs(turned.z - 350) < 1e-6, `and the turned copy's, through its half turn (${turned.x.toFixed(2)}, ${turned.z.toFixed(2)})`);

  const fit = corvetteFittingRows(corvette, copies, byName, (t: string) => (t.includes('keypad') ? 'keypad_model' : t.includes('geo_bunker') ? 'pod_model' : 'desk'));
  const rebelRows = fit.rows.filter((r: { building: string }) => r.building === CORVETTE_TEMPLATES.rebel);
  ok(rebelRows.length === 3 && fit.rows.length === 6, `a fitting written for one run stands only in that run's copies (${rebelRows.length} in the rebel copy, ${fit.rows.length} in all)`);
  const keypad = fit.rows.find((r: { use?: string }) => r.use === 'keypad') as { opens: string; opensCell: number; cell: number; bx: number; name: string } | undefined;
  ok(!!keypad && keypad.opens === 'bridge66' && keypad.opensCell === 3 && keypad.cell === 2 && keypad.bx === 1000 && keypad.name === 'Keypad', 'a keypad says which room it opens, by name and by index, and stands in its own room of its own copy');
  ok(fit.rows.some((r: { use?: string }) => r.use === 'pod') && fit.rows.filter((r: { use?: string }) => !r.use).length === 2, 'an escape pod console says it is one, and a computer is only to look at');

  // The Star Destroyer's crew of ours.
  ok(sdKindOf('hallway07') === 'hall' && sdKindOf('mainhangar') === 'barracks' && sdKindOf('commandeck') === 'bridge' && sdKindOf('reactorchamber') === 'thrusterroom' && sdKindOf('room03') === 'vipquarters', 'a Star Destroyer room is crewed as the corvette room of its kind');
  ok(sdKindOf('elevator03') === null && sdKindOf('reactorlift') === null && sdKindOf('exterior') === null, 'and nobody stands in a lift shaft or outside');
  ok(corvetteKindOf('hall62') === 'hall' && corvetteKindOf('thrustersubroom27') === 'thrustersubroom', 'a corvette room\'s kind is its name without its number');
  const square = (x0: number, z0: number, s: number) => ({ floor: { v: [x0, 0, z0, x0 + s, 0, z0, x0 + s, 0, z0 + s, x0, 0, z0 + s], t: [0, 1, 2, -1, -1, -1, -1, -1, -1, 7, 0, 2, 3, -1, -1, -1, -1, -1, -1, 7] } });
  ok(Math.abs(floorTriangles(square(0, 0, 4).floor).reduce((a: number, t: number[]) => a + t[9], 0) - 16) < 1e-9, 'a floor\'s triangles are measured by their area');
  const crewTable = [
    { who: 'novatrooper', room: 'hall3' },
    { who: 'novatrooper_cadet', room: 'hall4' },
    { who: 'novatrooper', room: 'barracks7' },
    { who: 'novatrooper', room: 'barracks7' },
    { who: 'corvette_imperial_inquisitor', room: 'barracks7' },
  ];
  const corvetteCells = [
    { index: 3, name: 'hall3' },
    { index: 4, name: 'hall4' },
    { index: 7, name: 'barracks7' },
  ];
  const kindRooms = corvetteKindRooms(crewTable, corvetteCells, { 3: square(0, 0, 4), 4: square(0, 0, 4), 7: square(0, 0, 10) });
  ok(kindRooms.length === 3 && kindRooms.find((k: { kind: string }) => k.kind === 'barracks')?.people === 3, 'the corvette\'s rooms are counted and measured by kind');
  const sdCopies = [{ id: 900, template: 'sd', pos: [0, 625, 0], q: [1, 0, 0, 0], cells: new Map([[1, 901], [2, 902], [3, 903]]) }];
  const sdCells = [
    { index: 1, name: 'mainhangar' },
    { index: 2, name: 'hallway01' },
    { index: 3, name: 'elevator00' },
  ];
  const sdFloors = { 1: square(10, 10, 100), 2: square(-5, 0, 4), 3: square(0, 0, 3) };
  const ours = ourCrewRows(sdCopies, sdCells, sdFloors, crewTable, kindRooms);
  const hangar = ours.filter((r: Raw) => r.cell === 901);
  ok(hangar.length === Math.min(OUR_CREW.perRoomMax, Math.round((3 / 1) * OUR_CREW.scaleMax)) && ours.filter((r: Raw) => r.cell === 902).length === 1 && !ours.some((r: Raw) => r.cell === 903), `a big hangar takes the barracks' crew grown by its floor (${hangar.length}), a hallway the hall's, a lift shaft nobody`);
  ok(ours.every((r: Raw) => r.ours && r.from === 'ours' && r.respawn === 0) && !ours.some((r: Raw) => r.who === 'corvette_imperial_inquisitor'), 'every one of them says it is ours, and nobody the corvette stands once (its story\'s people) is one of the crew');
  ok(hangar.every((r: Raw) => -r.x >= 10 && -r.x <= 110 && r.z >= 10 && r.z <= 110), 'each stands on its own room\'s floor, its X turned back from the pack\'s to the snapshot\'s way round');
  const ours2 = ourCrewRows(sdCopies, sdCells, sdFloors, crewTable, kindRooms);
  ok(JSON.stringify(ours) === JSON.stringify(ours2), 'and every run writes the same crew in the same places');
  // How a room's crew grows with its floor, under the cap: the hall kind holds one person on 16 m², so a
  // hallway of 100 m² takes three (its floor grown past `scaleMax`, held there), and one of 4 m² still one. A
  // small room of a kind that holds three takes all three (never scaled under one room's worth).
  const more = [
    { index: 1, name: 'hallway02' },
    { index: 2, name: 'hallway03' },
    { index: 3, name: 'security' },
  ];
  const grown = ourCrewRows(sdCopies, more, { 1: square(0, 0, 10), 2: square(0, 0, 2), 3: square(0, 0, 5) }, crewTable, kindRooms);
  const count = (cell: number) => grown.filter((r: Raw) => r.cell === cell).length;
  ok(OUR_CREW.scaleMax * 1 < OUR_CREW.perRoomMax && count(901) === OUR_CREW.scaleMax, `a hallway six times the hall's floor takes the hall's one person times scaleMax (${count(901)})`);
  ok(count(902) === 1, `a hallway a quarter of it still takes one (${count(902)})`);
  ok(count(903) === 3, `and a guard room a quarter of the barracks' floor still takes the barracks' three (${count(903)})`);
  // Where they stand is drawn by area: a room whose floor is a sliver and a broad triangle puts nearly
  // everybody on the broad one.
  const lopsided = { floor: { v: [0, 0, 0, 0.1, 0, 0, 0, 0, 0.1, 20, 0, 0, 0, 0, 20], t: [0, 1, 2, -1, -1, -1, -1, -1, -1, 7, 0, 3, 4, -1, -1, -1, -1, -1, -1, 7] } };
  const spread = ourCrewRows(sdCopies, [{ index: 1, name: 'mainhangar' }], { 1: lopsided }, crewTable, kindRooms);
  const onBroad = spread.filter((r: Raw) => -r.x + r.z > 0.11).length;
  ok(spread.length >= 3 && onBroad >= spread.length - 1, `each stands on a triangle drawn by its area, not the first one (${onBroad} of ${spread.length} on the broad one)`);

  ok(takerFaction([{ who: 'pilot_a', planet: 'naboo', faction: 'imperial' }], 'naboo', 'pilot_a') === 'imperial' && takerFaction([{ who: 'pilot_a', planet: 'naboo', faction: 'imperial' }], 'tatooine', 'pilot_a') === null, 'a taker sends a player to its faction\'s copy, on its own world only');
  const takers = [{ who: 'pilot_a', planet: 'naboo', faction: 'imperial' }];
  ok(instanceSpawnsWhy(true, null, takers, () => null)?.includes('no spawns.json') === true, 'status asks for spawns while the instances zone is converted with nobody aboard');
  ok(instanceSpawnsWhy(true, { instances: INSTANCES_FORMAT - 1 }, takers, () => null)?.includes('older') === true, 'and while its people are an older converter\'s');
  ok(instanceSpawnsWhy(false, null, takers, () => [{ who: 'pilot_a' }])?.includes('naboo') === true && instanceSpawnsWhy(false, null, takers, () => [{ who: 'pilot_a', takes: 'imperial' }]) === null && instanceSpawnsWhy(false, null, takers, () => null) === null, 'and while a taker\'s row on a converted world does not say where it sends a player, and nothing once it does');
}

// ------------------------------------------------------------------ the converter: the reference the checkout carries
{
  const ref = JSON.parse(readFileSync(new URL('../core3ref/corvette.json', import.meta.url), 'utf8')) as Record<string, { who: string; x: number; y: number; z: number; room: string }[]> & { takers?: { who: string; planet: string; faction: string }[] };
  const crews = [...ref.rebel, ...ref.imperial, ...ref.neutral];
  ok(crews.length === 268, `the reference holds the corvette's 268 people (${crews.length})`);
  ok((ref.takers ?? []).length === 3 && new Set((ref.takers ?? []).map((t) => t.faction)).size === 3, `and its three ticket takers, one per run (${(ref.takers ?? []).map((t) => `${t.who} on ${t.planet} for ${t.faction}`).join(', ')})`);
  // The corvette's own layout, out of whichever pack has converted it: the instances zone, else the gallery.
  const packs = ['dungeon1', 'gallery'].map((p) => join('assets-private', p, 'manifest.json')).filter((f) => existsSync(f));
  let def: { id: string; cells: { index: number; name: string; bounds: { min: number[]; max: number[] } }[] } | null = null;
  for (const f of packs) {
    const man = JSON.parse(readFileSync(f, 'utf8')) as { categories: Record<string, { id: string; cells?: { index: number; name: string; bounds: { min: number[]; max: number[] } }[] }[]> };
    const d = Object.values(man.categories).flat().find((x) => x.id === 'thm_spc_corvette_dungeon' && x.cells?.length);
    if (d) {
      def = d as typeof def;
      break;
    }
  }
  if (!def) note('no converted pack carries the corvette\'s layout: the rows are not checked against its rooms here');
  else {
    const byName = cellIndexByName(def.cells);
    const lost = crews.filter((r) => !byName.has(r.room));
    ok(lost.length === 0, `all 268 of them stand in a room the corvette's own layout names (${lost.length} do not)`);
    // The bridge: the rebel run's bridge crewman, carried into the layout's frame (its X turned, as every
    // model of the pack is), lands inside bridge66's own box.
    const row = ref.rebel.find((r) => r.room === 'bridge66')!;
    const cell = def.cells.find((c) => c.name === 'bridge66')!;
    const lo = [0, 1, 2].map((a) => Math.min(cell.bounds.min[a], cell.bounds.max[a]) - 0.5);
    const hi = [0, 1, 2].map((a) => Math.max(cell.bounds.min[a], cell.bounds.max[a]) + 0.5);
    const p = [-row.x, row.y + 0.5, row.z];
    ok(p.every((v, a) => v >= lo[a] && v <= hi[a]), `a known bridge row (${row.who} at ${row.x}, ${row.y}, ${row.z}) lands inside bridge66's box (${lo.map((v) => v.toFixed(0))} to ${hi.map((v) => v.toFixed(0))})`);
    const statics = (ref.statics as unknown as { room: string; data?: string; fn?: string }[]) ?? [];
    ok(statics.every((s) => byName.has(s.room)) && statics.filter((s) => s.fn === 'setupKeypad' || s.fn === 'setupRoomPanel').every((s) => byName.has(s.data ?? '')), 'every fitting stands in a room it names, and every keypad and panel opens one');
  }
}

// ------------------------------------------------------------------ the converter: the packs, where the install has them
{
  const zone = join('assets-private', 'dungeon1');
  const spawnsFile = join(zone, 'spawns.json');
  if (!existsSync(join(zone, 'layout.json')) || !existsSync(spawnsFile)) note('the instances zone is not converted here: its packs are not checked');
  else {
    const lay = JSON.parse(readFileSync(join(zone, 'layout.json'), 'utf8')) as { objects: { template: string; model: string; x: number; y: number; z: number; contained?: boolean }[] };
    const man = JSON.parse(readFileSync(join(zone, 'manifest.json'), 'utf8')) as { categories: { layout: { id: string; cells?: unknown[] }[] } };
    const sd = lay.objects.find((o) => isStarDestroyerDungeon(o.template));
    const sdDef = man.categories.layout.find((d) => d.id === sd?.model);
    ok(!!sdDef && (sdDef.cells?.length ?? 0) >= 59, `the heroic Star Destroyer is drawn as its portal layout, ${sdDef?.cells?.length ?? 0} rooms, rather than as a hull with none (${sd?.model})`);
    const pack = JSON.parse(readFileSync(spawnsFile, 'utf8')) as { instances?: number; statics: { key: string; who: string; from: string; room?: number; ours?: boolean; cell: number }[] };
    const corvette = pack.statics.filter((r) => r.from === 'corvette');
    const ours = pack.statics.filter((r) => r.ours);
    ok(pack.instances === INSTANCES_FORMAT && corvette.length === 4288 && corvette.every((r) => r.room && r.cell), `every copy has its crew, each in a room of its own copy (${corvette.length} over 48 copies)`);
    ok(ours.length > 0 && ours.every((r) => r.from === 'ours' && r.room), `and the Star Destroyers a crew of ours, every row saying so (${ours.length})`);
    // A server shares a body by its row's name: one name twice in the pack would be one body in two places.
    const keys = new Set(pack.statics.map((r) => r.key));
    ok(keys.size === pack.statics.length, `every one of the ${pack.statics.length} rows has a name of its own (${pack.statics.length - keys.size} twice)`);
    // Each copy takes its own run's crew: everybody only one run stands is stood exactly once in each of that
    // run's sixteen copies, and no room of any copy holds two runs' people.
    const ref = JSON.parse(readFileSync(new URL('../core3ref/corvette.json', import.meta.url), 'utf8')) as Record<'rebel' | 'imperial' | 'neutral', { who: string }[]>;
    const runs = ['rebel', 'imperial', 'neutral'] as const;
    const runOf = new Map<string, string>();
    const shared = new Set<string>();
    for (const run of runs) for (const r of ref[run]) {
      if (runOf.has(r.who) && runOf.get(r.who) !== run) shared.add(r.who);
      runOf.set(r.who, run);
    }
    const wrong: string[] = [];
    for (const run of runs) {
      const each = new Map<string, number>();
      for (const r of ref[run]) if (!shared.has(r.who)) each.set(r.who, (each.get(r.who) ?? 0) + 1);
      for (const [who, n] of each) {
        const stood = corvette.filter((r) => r.who === who).length;
        if (stood !== n * 16) wrong.push(`${who} ${stood}/${n * 16}`);
      }
    }
    ok(wrong.length === 0, `every person only one run stands is stood once in each of its sixteen copies (${wrong.length ? wrong.slice(0, 4).join(', ') : 'all'})`);
    const roomRuns = new Map<number, Set<string>>();
    for (const r of corvette) {
      if (shared.has(r.who)) continue;
      const set = roomRuns.get(r.cell) ?? new Set<string>();
      set.add(runOf.get(r.who) ?? '?');
      roomRuns.set(r.cell, set);
    }
    ok([...roomRuns.values()].every((s) => s.size === 1), `and none of the ${roomRuns.size} rooms crewed holds two runs' people`);
    // And what `status` reads off the same packs asks for nothing.
    const takers = (JSON.parse(readFileSync(new URL('../core3ref/corvette.json', import.meta.url), 'utf8')) as { takers?: { who: string; planet: string; faction: string }[] }).takers ?? [];
    const rowsOf = (w: string) => {
      const f = join('assets-private', w, 'spawns.json');
      return existsSync(f) ? ((JSON.parse(readFileSync(f, 'utf8')) as { statics?: { who: string; takes?: string }[] }).statics ?? []) : null;
    };
    const why = instanceSpawnsWhy(true, pack, takers, rowsOf);
    ok(why === null, `status asks nothing of the converted packs here (${why ?? 'nothing'})`);
    for (const t of takers) {
      const rows = rowsOf(t.planet);
      if (rows) ok(rows.some((r) => r.who === t.who && r.takes === t.faction), `${t.planet}'s ticket taker (${t.who}) says it sends a player to the ${t.faction} run`);
    }
    const fittings = join(zone, 'fittings.json');
    if (existsSync(fittings)) {
      const f = JSON.parse(readFileSync(fittings, 'utf8')) as { rows: { use?: string; opensCell?: number }[] };
      const keypads = f.rows.filter((r) => r.use === 'keypad' || r.use === 'panel');
      ok(keypads.length > 0 && keypads.every((r) => (r.opensCell ?? 0) > 0) && f.rows.some((r) => r.use === 'pod'), `the corvette's keypads open rooms and its pods are there (${keypads.length} keypads and panels, ${f.rows.filter((r) => r.use === 'pod').length} pods)`);
    }
    // Every dungeon of the zone has its copies, counted as the game counts them, and every one of them names a
    // building the zone draws with rooms.
    const models = new Map((Object.values(man.categories).flat() as { id: string; cells?: unknown[] }[]).map((d) => [d.id, d]));
    for (const d of INSTANCES.filter((x) => packOfInstance(x) === 'dungeon1')) {
      const copies = copiesOf(lay.objects, d);
      const roomless = copies.filter((o) => !(models.get(o.model)?.cells?.length));
      ok(copies.length >= 10 && roomless.length === 0, `${d.kind}: ${copies.length} copies placed, every one drawn with its rooms (${roomless.length} without)`);
    }
  }
  // Every way in a world places is placed there, where the world is converted.
  for (const e of ENTRANCES) {
    const f = join('assets-private', e.pack, 'layout.json');
    if (!existsSync(f)) continue;
    const lay = JSON.parse(readFileSync(f, 'utf8')) as { objects: { template: string }[] };
    ok(lay.objects.some((o) => o.template === e.template), `${e.pack}: the way into ${e.kind} is placed (${e.template.split('/').pop()})`);
  }
  for (const d of INSTANCES.filter((x) => packOfInstance(x) !== 'dungeon1')) {
    const f = join('assets-private', packOfInstance(d), 'layout.json');
    if (!existsSync(f)) continue;
    const lay = JSON.parse(readFileSync(f, 'utf8')) as { objects: { template: string; contained?: boolean }[] };
    ok(lay.objects.filter((o) => !o.contained && d.templates.includes(o.template)).length >= 8, `${d.kind}: its copies are placed in ${packOfInstance(d)}`);
  }
}

// ------------------------------------------------------------------ the game
{
  ok(INSTANCES.every((d) => d.templates.length && d.name && d.planet) && new Set(INSTANCES.map((d) => d.kind)).size === INSTANCES.length, 'every dungeon has its copies, its name and its world, and a kind of its own');
  ok(ENTRANCES.every((e) => !!instanceOf(e.kind)) && ABOARD.every((a) => !!instanceOf(a.kind)), 'every way in leads somewhere the table has');
  ok(ENTRANCES.filter((e) => e.ours).map((e) => e.kind).sort().join() === 'axkva,decrepit,ig88,working', 'and the links that are ours say so: Axkva Min, IG-88 and which droid factory each of the factory\'s two things opens');
  ok(corvetteFor('rebel')?.kind === 'corvette_rebel' && corvetteFor('nope') === null && corvetteFor(undefined) === null, 'a taker\'s word finds its corvette, and no word none');
  ok(instanceOfTemplate(CORVETTE_TEMPLATES.imperial)?.kind === 'corvette_imperial' && instanceOfTemplate('object/building/x.iff') === null, 'a copy is known by its template');
  ok(packOfInstance(instanceOf('avatar')!) === 'kashyyyk_pob_dungeons' && packOfInstance(instanceOf('stardestroyer')!) === 'dungeon1' && packOfInstance(instanceOf('uplink')!) === 'mustafar', 'and its world by the pack it loads');

  // Which copy: the same for the same group, spread over the copies, and never out of range.
  const n = 16;
  ok(copyIndex('group-7', 'corvette_rebel', n) === copyIndex('group-7', 'corvette_rebel', n), 'a group is sent to the same copy every time');
  const used = new Set<number>();
  for (let i = 0; i < 400; i++) used.add(copyIndex(`group-${i}`, 'corvette_rebel', n));
  ok(used.size === n && [...used].every((i) => i >= 0 && i < n), `four hundred groups use all ${n} copies between them (${used.size})`);
  ok(copyIndex('x', 'k', 0) === -1, 'and with no copy there is none to go to');
  const objects = [
    { template: 'a', x: 5, y: 0, z: 0 },
    { template: 'a', x: -5, y: 0, z: 9 },
    { template: 'a', x: -5, y: 0, z: 1 },
    { template: 'a', x: 0, y: 0, z: 0, contained: true },
    { template: 'b', x: 0, y: 0, z: 0 },
  ];
  ok(copiesOf(objects, { templates: ['a'] }).map((o) => `${o.x},${o.z}`).join(' ') === '-5,1 -5,9 5,0', 'the copies are counted in a fixed order, across then along, and never anything inside a building');

  ok(entrancesOf('mustafar').length === 6 && entrancesOf('yavin4')[0]?.kind === 'exarkun' && entrancesOf('naboo').length === 0, 'each world has its own ways in');
  ok(aboardOf('space_heavy1', { name: 'Star Destroyer', model: 'star_destroyer_space' })?.kind === 'stardestroyer' && aboardOf('space_kashyyyk', { name: 'spacestation_avatar_platform', model: 'spacestation_neutral' })?.kind === 'avatar', 'a ship docked at the Star Destroyer or the Avatar platform station may go aboard');
  ok(aboardOf('space_kashyyyk', { name: 'station_kashyyyk', model: 'spacestation_neutral' }) === null && aboardOf('space_heavy1', null) === null, 'and at an ordinary station, or docked at nothing, may not');

  // Back by the taker: in front of them, facing them.
  const b = besideTaker(10, 20, 0, 3);
  ok(Math.abs(b.x - 10) < 1e-9 && Math.abs(b.z - 23) < 1e-9 && Math.abs(Math.abs(b.heading) - Math.PI) < 1e-9, 'a player sent back by the taker stands a few steps in front of them, facing them');
  const turned = besideTaker(0, 0, Math.PI / 2, 2);
  ok(Math.abs(turned.x - 2) < 1e-9 && Math.abs(turned.z) < 1e-9, 'whichever way the taker faces');

  // The way back, as kept between sessions.
  const kept = { kind: 'stardestroyer', planet: 'space_heavy1', at: [1, 2, 3], heading: 0.5, ship: { def: 'xwing', condition: null, dock: { key: 'k', lane: 'a' }, pos: [1, 2, 3], quat: [0, 0, 0, 1] } };
  const read = readWayBack(JSON.parse(JSON.stringify(kept)));
  ok(!!read && read.ship?.dock?.lane === 'a' && read.at[2] === 3 && read.heading === 0.5, 'a kept way back reads back whole, the ship left docked with it');
  const onFoot = readWayBack({ kind: 'myyydril', planet: 'kashyyyk', zone: 'dead_forest', at: [4, 5, 6], heading: 1, indoors: true });
  ok(onFoot?.zone === 'dead_forest' && onFoot.indoors === true && !onFoot.ship, 'a way back in a zone of a world, in a room, reads back with its zone and its room');
  ok(readWayBack({ kind: 'x', planet: 'tatooine', zone: '', at: [0, 0, 0], heading: 0, indoors: 'yes' })?.zone === undefined && readWayBack({ kind: 'x', planet: 'tatooine', at: [0, 0, 0], heading: 0, indoors: 'yes' })?.indoors === undefined, 'and an empty zone or a room that is not a plain yes reads as none of either');
  const flying = readWayBack({ kind: '', planet: 'space_heavy1', at: [1, 2, 3], heading: 0, ship: { def: 'xwing', condition: null, pos: [1, 2, 3], quat: [0, 0, 0, 1] } });
  ok(!!flying?.ship && flying.ship.dock === undefined, 'a ship left flying (a member who followed the group in from its controls) reads back with no dock');
  const halfDock = readWayBack({ kind: '', planet: 'space_heavy1', at: [1, 2, 3], heading: 0, ship: { def: 'xwing', condition: null, dock: { key: 'k' }, pos: [1, 2, 3], quat: [0, 0, 0, 1] } });
  ok(!!halfDock?.ship && halfDock.ship.dock === undefined, 'and half a dock is no dock, so the ship is stood flying rather than docked at nothing');
  ok(readWayBack({ kind: 'x', planet: 'tatooine', at: [1, 2], heading: 0 }) === null && readWayBack('nonsense') === null && readWayBack({ kind: 'x', planet: 'tatooine', at: [1, 2, Number.NaN], heading: 0 }) === null, 'and anything not well formed reads as none');
  ok(fallbackBack('corvette_rebel').planet === 'corellia' && fallbackBack('corvette_imperial').planet === 'naboo' && fallbackBack('corvette_neutral').planet === 'tatooine', 'with no way back kept the corvette is left for its own taker\'s world: the Alliance\'s run Corellia, the Empire\'s Naboo, the neutral run Tatooine');
  ok(fallbackBack('stardestroyer').planet === 'space_heavy1' && fallbackBack('myyydril').planet === 'kashyyyk' && fallbackBack('myyydril').zone === 'dead_forest' && fallbackBack('uplink').planet === 'mustafar' && fallbackBack('nothing').planet === 'tatooine', 'and every other dungeon for its own way in');
  ok(aboardOf('space_kashyyyk', { name: 'Star Destroyer', model: 'star_destroyer_space' }) === null && aboardOf('space_heavy1', { name: 'spacestation_avatar_platform', model: 'x' }) === null, 'a hull of the right name or model in the wrong zone is nothing to go aboard');

  // A copy's fittings in the world's frame, with what pressing the key at one does (`fittingsOf`): the room it
  // opens by index and by name, what the server called it, and where the copy it stands in stands, which is
  // how the game tells one copy's keypads from the next copy's.
  const centre = { x: 100, z: -50 };
  const at = { building: CORVETTE_TEMPLATES.rebel, by: 0, bx: 1400, bz: 600, byaw: 0, yaw: 0 };
  const hand = fittingsOf([
    { ...at, model: 'keypad_model', template: 'object/tangible/dungeon/keypad_terminal.iff', cell: 2, x: 1, y: 1.2, z: 3, use: 'keypad', opens: 'bridge66', opensCell: 66, name: 'Keypad' },
    { ...at, model: 'pod_model', cell: 1, x: 0, y: 0, z: 0, use: 'pod', name: 'Escape Pod Controls' },
    { ...at, model: 'desk', cell: 2, x: 0, y: 0, z: 0, use: 'chair' as never, opensCell: -3 },
  ], centre);
  ok(hand[0].use === 'keypad' && hand[0].opensCell === 66 && hand[0].opens === 'bridge66' && hand[0].name === 'Keypad', 'a keypad keeps the room it opens, by index and by name, and what the server called it');
  ok(hand[0].bx === -(1400 - 100) && hand[0].bz === 600 + 50 && Math.abs(hand[0].x - (hand[0].bx - 1)) < 1e-9 && Math.abs(hand[0].z - (hand[0].bz + 3)) < 1e-9, 'and stands in its own copy, whose place in the world it carries');
  ok(hand[1].use === 'pod' && hand[1].opensCell === undefined && hand[1].name === 'Escape Pod Controls', 'a pod\'s console says it is one and opens nothing');
  ok(hand[2].use === undefined && hand[2].opensCell === undefined, 'and a thing to look at does nothing, whatever a row on another build says');

  // The corvette's locked rooms.
  const locks = new InstanceLocks<string>();
  locks.lock('copy-a', [38, 66, 0]);
  ok(locks.isLocked('copy-a', 66) && !locks.isLocked('copy-a', 0) && !locks.isLocked('copy-b', 66), 'a copy\'s rooms a keypad opens are locked, and nothing in another copy');
  ok(locks.refuses('copy-a', [62, 66]) && !locks.refuses('copy-a', [62, 61]), 'a door into a locked room stays shut and every other door opens');
  ok(locks.unlock('copy-a', 66) && !locks.refuses('copy-a', [62, 66]) && !locks.unlock('copy-a', 66), 'used once, the keypad opens it for good');
  locks.lock('copy-a', [66]);
  ok(!locks.isLocked('copy-a', 66), 'and a copy already known keeps what was opened in it when its fittings are stood again');
  // A room opened before its copy's locks are made (another member's keypad heard first, or the room the
  // player comes back standing in) is left out of them when they are; one opened after is opened at once.
  ok(!locks.open('copy-b', 38) && !locks.knows('copy-b'), 'a room opened in a copy whose locks are not made yet is held, and makes no locks of its own');
  locks.lock('copy-b', [38, 66]);
  ok(!locks.isLocked('copy-b', 38) && locks.isLocked('copy-b', 66), 'and is left out of them when they are made, the rest locked');
  ok(locks.open('copy-b', 66) && !locks.isLocked('copy-b', 66) && !locks.open('copy-b', 66), 'opened once they are made, it is opened at once, and only once');
  ok(!locks.open('copy-c', 0) && !locks.knows('copy-c'), 'and the outside is never a room to open');
  locks.open('copy-d', 38);
  locks.clear();
  locks.lock('copy-d', [38]);
  ok(locks.isLocked('copy-d', 38), 'what was held for a copy goes with the world, so the next visit\'s locks are whole');
  locks.clear();
  ok(!locks.refuses('copy-a', [38]) && locks.copies === 0, 'with the world left, nothing is locked');

  // The keypad's word to the rest of the group (server/copyWire.mjs): checked and shaped as every word is.
  const word = cleanUnlock({ t: 'unlock', kind: 'corvette_rebel', at: [1400.5, -600], cell: 38 });
  ok(!!word && word.kind === 'corvette_rebel' && word.at[0] === 1400.5 && word.cell === 38, 'a keypad\'s word says which dungeon, where its copy stands and which room');
  ok(cleanUnlock({ kind: 'Corvette Rebel', at: [0, 0], cell: 1 }) === undefined && cleanUnlock({ kind: 'k', at: [0], cell: 1 }) === undefined && cleanUnlock({ kind: 'k', at: [0, Number.NaN], cell: 1 }) === undefined && cleanUnlock({ kind: 'k', at: [0, 0], cell: 0 }) === undefined && cleanUnlock({ kind: 'k', at: [0, 0], cell: 2.5 }) === undefined && cleanUnlock({ kind: 'k', at: [0, 0], cell: COPY_WIRE.cell + 1 }) === undefined && cleanUnlock(null) === undefined && cleanUnlock([1]) === undefined, 'and anything else is dropped: a kind that is not a word, a place that is not two numbers, a room that is not one');
  ok(cleanUnlock({ kind: 'k', at: [1e300, -1e300], cell: 1 })?.at.every((v: number) => Math.abs(v) === COPY_WIRE.limit) === true && cleanUnlock({ kind: 'k'.repeat(80), at: [0, 0], cell: 1 })?.kind.length === COPY_WIRE.kind, 'a place far past any world is held to the limit, and a long kind cut to length');
  const window = { at: 0, lines: 0 };
  let sent = 0;
  for (let i = 0; i < COPY_WIRE.perSecond + 3; i++) if (mayOpen(window, 1000)) sent++;
  ok(sent === COPY_WIRE.perSecond && mayOpen(window, 2000), `a browser may say it ${COPY_WIRE.perSecond} times a second and no more, and again the next second`);

  // What E does.
  const where = { live: true, keypad: false, pod: false, wayOut: false, wayIn: false };
  ok(instanceUse({ ...where, keypad: true, pod: true, wayOut: true }) === 'keypad' && instanceUse({ ...where, pod: true, wayOut: true }) === 'pod' && instanceUse({ ...where, wayOut: true, wayIn: true }) === 'out' && instanceUse({ ...where, wayIn: true }) === 'in', 'the thing in front of you first, then the pod, then the way out, then a way in');
  ok(instanceUse({ ...where, live: false, keypad: true }) === '' && instanceUse(where) === '', 'and nothing at all while the game is not being played, or where there is nothing');
  ok(roomWords('meetingroom38') === 'meeting room' && roomWords('officerquarters63') === "officers' quarters" && roomWords('bridge66') === 'bridge' && roomWords('elevator57') === 'lift', "a keypad's room is said in words, its number off");
  ok(roomWords(null) === 'room' && roomWords('constructor') === 'constructor' && roomWords('engine_room2') === 'engine room', "and a room with no name, a name that is one of the language's own, or one the table has not got still reads as words");
  const before = { ...INSTANCE_TUNE };
  tuneInstances({ exitReach: 9, useReach: -1 } as Partial<typeof INSTANCE_TUNE>);
  ok(INSTANCE_TUNE.exitReach === 9 && INSTANCE_TUNE.useReach === before.useReach, 'the numbers move live, and never to nothing');
  Object.assign(INSTANCE_TUNE, before);

  // The bar says the same as the key.
  const s = newPromptState();
  const out = newPromptActions();
  s.live = true;
  s.instance = 'keypad';
  ok(fillActions(s, out) >= 1 && out[0].label === PROMPT_WORDS.keypad, 'the bar offers the keypad');
  s.instance = 'out';
  s.travel = 'terminal';
  fillActions(s, out);
  ok(out[0].label === PROMPT_WORDS.wayOut, 'and the way out before a port\'s things, as the key takes them');
  s.instance = '';
  s.doorless = true;
  fillActions(s, out);
  ok(out[0].label === PROMPT_WORDS.inside, 'after the way into a building with no door, which is underfoot');
  ok([PROMPT_WORDS.keypad, PROMPT_WORDS.pod, PROMPT_WORDS.wayOut, PROMPT_WORDS.wayIn].every((w) => w.length <= PROMPT.maxLabel), 'every word of it fits the bar');

  // A ticket taker's own answer.
  const taker = talkOptions(false, false, [], false, true);
  ok(taker[0].id === 'corvette' && taker[0].label === TALK_WORDS.corvette && taker.length === 3, 'a ticket taker offers the trip to the ship first');
  ok(talkOptions(false, false).length === 2 && talkOptions(true, false, [], false, true)[0].id === 'stay', 'and nobody else does, nor a taker already following you');

  // The ground the client never drew.
  ok(emptyGround([{ shader: 'null_a_punchout', texture: 'texture/null.dds' }]) && !emptyGround([{ shader: 'null_a_punchout', texture: 'texture/null.dds' }, { shader: 'terrain_grass', texture: 'texture/grass.dds' }]) && !emptyGround([]) && !emptyGround([{}]), 'a terrain whose every family is the empty punch-out is ground the client never drew; one real family, or a pack that says nothing, is drawn');
}

// The main file's own dispatch: the copy's things after what is underfoot and before a port's.
{
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8');
  ok(/if \(!this\.handleElevator\(\) && !this\.handleInstance\(\) && !this\.handleTravel\(\)/.test(main), 'the use key reaches a dungeon\'s things in the bar\'s own order');
  // Nobody is left in the empty sky between the copies: a character saved there (the smoke test found one) is
  // sent back the way they came once the screen lifts, from the start of a session and from every travel.
  const stranded = main.match(/await this\.loadingScreen\.hide\(\);\s*this\.traveling = false;\s*this\.input\.requestLock\(\);\s*this\.leaveIfStranded\(\);/g) ?? [];
  ok(stranded.length === 2, `a player in the world of copies and in none of them is sent back out after a session's start and after a travel (${stranded.length} of 2)`);
  ok(/private leaveIfStranded\(\): void \{\s*if \(!this\.world\.planet\.instances \|\| this\.instanceHere \|\| this\.traveling\) return;/.test(main), 'and only there, only when no copy holds them, and never in the middle of another move');

  // The seams that make a keypad's room a locked room, each of which a test of the locks alone cannot see.
  const world = readFileSync(new URL('../../../src/world/world.ts', import.meta.url), 'utf8');
  ok(/this\.doors\.mayOpen = \(door\) => !this\.instanceLocks\.refuses\(door\.building\.object, door\.cells\);/.test(world), 'a door answers the copy\'s locks, by the copy its building is and the two rooms it stands between');
  ok(/liftStops\(b\.model\.def, this\.cellState\.cell\)\.filter\(\(s\) => !locks\.isLocked\(b\.object, s\.cell\)\)/.test(world), 'and the lift will not stop at a locked room');
  const unload = world.indexOf('  private unload(): void {');
  ok(unload > 0 && /this\.instanceLocks\.clear\(\);/.test(world.slice(unload, world.indexOf('\n  }', unload))), 'and the locks go with the world');
  ok(/scope: \(x, y, z\) => this\.inCopy\(x, y, z\),/.test(world) && /private inCopy\(x: number, y: number, z: number\): boolean \{\s*if \(!this\.planet\?\.instances\) return true;\s*const b = this\.cellState\?\.building;\s*if \(!b\) return false;/.test(world), 'nobody stands in a world of copies but in the copy the player is in, and everybody anywhere else');
  // Locks made only from the copy's whole list of fittings, and a room the player comes back standing in
  // left open; the word to the group sent at the keypad and heard for the copy this player is in.
  ok(/if \(!here\.object \|\| !this\.fittingRowsIn\) return;\s*this\.world\.instanceLocks\.lock\(/.test(main), 'a copy is locked only once its fittings are in hand, never from the empty list of a world still fetching them');
  ok(/if \(beside && here\.object && here\.cell > 0\) this\.world\.instanceLocks\.open\(here\.object, here\.cell\);/.test(main), 'a room the player comes back into a copy standing in is not locked round them');
  ok(/this\.net\.sendWord\(\{ t: 'unlock', kind: here\.def\.kind, at: \[here\.x, here\.z\], cell: f\.opensCell \}\)/.test(main) && /this\.heardUnlock\(msg\);/.test(main), 'a keypad\'s room is opened for the rest of the group, and their word heard here');
  const relay = readFileSync(new URL('../../../server/relay.mjs', import.meta.url), 'utf8');
  const net = readFileSync(new URL('../../../src/net/net.ts', import.meta.url), 'utf8');
  ok(/\} else if \(msg\.t === 'unlock'\) \{[\s\S]{0,900}const to = groups\.chatTo\(c\.member\);/.test(relay) && /case 'unlock':/.test(net), 'the server passes the word to the group alone, and the browser hands it on');
  // A death in a copy comes round in its arrival room, stood in it again.
  ok(/if \(here && this\.spawn\.distanceToSquared\(here\.arrival\) < 1\) \{\s*this\.world\.enterCellAt\(this\.spawn, here\.cell\);/.test(main), 'a death in a dungeon copy comes round in the room the copy was come into');
  // Following the group into a world of copies is on foot, with the ship kept in the way back.
  const follow = main.search(/if \(planet\.instances\) \{\s*this\.closePanels\(\);\s*await this\.travel\(planet, zoneId, undefined, \{ back: this\.wayBackFromHere\(\) \}\);/);
  ok(follow > 0 && follow < main.indexOf("if ((move.withShip || move.do === 'jump') && this.refuseWhileDocked()) return;"), 'a member follows the group into a copy on foot, their ship kept to come back to, and a docked ship is no refusal');
}

// ------------------------------------------------------------------ the dungeon's doors, where the install has them
{
  // Every passable doorway of a room a keypad or a panel opens has a door in it, or the lock is a word with
  // nothing to stop anybody walking in.
  const zone = join('assets-private', 'dungeon1');
  const files = ['doors.json', 'manifest.json', 'fittings.json'].map((f) => join(zone, f));
  if (!files.every((f) => existsSync(f))) note('the instances zone\'s doors, rooms or fittings are not converted here: the locked doors are not checked');
  else {
    const doors = (JSON.parse(readFileSync(files[0], 'utf8')) as { models: Record<string, { cells: number[] }[]> }).models.thm_spc_corvette_dungeon ?? [];
    const man = JSON.parse(readFileSync(files[1], 'utf8')) as { categories: Record<string, { id: string; cells?: { index: number; name: string; portals?: { target: number; passable: boolean }[] }[] }[]> };
    const def = Object.values(man.categories).flat().find((d) => d.id === 'thm_spc_corvette_dungeon');
    const rows = (JSON.parse(readFileSync(files[2], 'utf8')) as { rows: { opensCell?: number }[] }).rows;
    const rooms = [...new Set(rows.filter((r) => (r.opensCell ?? 0) > 0).map((r) => r.opensCell!))].sort((a, b) => a - b);
    const open: string[] = [];
    for (const room of rooms) {
      const cell = def?.cells?.find((c) => c.index === room);
      for (const p of cell?.portals ?? []) if (p.passable && !doors.some((d) => d.cells.includes(room) && d.cells.includes(p.target))) open.push(`${cell?.name}->${p.target}`);
    }
    ok(rooms.length === 7 && !!def && open.length === 0, `every way into the corvette's ${rooms.length} locked rooms has a door to shut (${open.length ? open.join(', ') : 'none open'})`);
  }
}

if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log('\ninstances: all passed');
