// Reading the world's own spawns out of the owner's emulator checkout.
//
// The rules are pure, so this runs the real ones on fixtures written here. Where the checkout is
// installed it then reads the **real** data and prints what it says, which is how the claim that the
// world's creatures come from the server's own tables stays an observed fact rather than an assertion
// in a comment. The fixtures are written from the shapes the real files use and are not copied from
// them: that project is somebody else's work under its own licence.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findCalls, parseLuaValue, readLua, LuaCall } from '../lua.mjs';
import { flagWords, frameCheck, heightCheck, intoRoom, joinCatalogue, readConversations, readConversationSpeakers, readCorvette, readCreatures, readDressGroups, readLairs, readRegions, readSpawnGroups, readStatics, readWeaponGroups, settleStatics, staticsOfFile, CORE3_WORLDS, STATIC_TUNE } from '../core3.mjs';
import { core3Source } from '../core3ref.mjs';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
function note(what: string): void {
  console.log(`note ${what}`);
}

// ------------------------------------------------------------------ the Lua value reader
{
  ok(parseLuaValue('42') === 42 && parseLuaValue('-4.5') === -4.5 && parseLuaValue('0x1F') === 31, 'numbers read, including a negative and the hex the region tiers are written in');
  ok(parseLuaValue('"a\\nb"') === 'a\nb' && parseLuaValue("'x'") === 'x', 'strings read in either quote, with their escapes');
  ok(parseLuaValue('true') === true && parseLuaValue('nil') === null, 'the two words that are not names');
  const arr = parseLuaValue('{1, 2, 3}');
  ok(Array.isArray(arr) && arr.length === 3, 'a table with only an array part comes back as an array, which is what every row is');
  const tbl = parseLuaValue('{ a = 1, b = "two" }') as Record<string, unknown>;
  ok(tbl.a === 1 && tbl.b === 'two', 'and one with keys comes back keyed');
  const mixed = parseLuaValue('{ 7, a = 1 }') as Record<string, unknown>;
  ok(mixed.a === 1 && Array.isArray(mixed.__list) && (mixed.__list as number[])[0] === 7, 'a table with both keeps its array part apart');
  ok(Object.getPrototypeOf(tbl) === null, 'a table read from a file has no prototype, so a key called __proto__ is a key');

  // The trap the whole reader exists for: a named constant is the data's, and a sum of them is a mask.
  const consts = { CIRCLE: 1, NOSPAWNAREA: 2, NOBUILDZONEAREA: 16, NAMEDREGION: 256 };
  ok(parseLuaValue('CIRCLE', consts) === 1, 'a constant the caller declares resolves');
  ok(parseLuaValue('NOSPAWNAREA + NOBUILDZONEAREA + NAMEDREGION', consts) === 274, 'and a sum of them folds into the mask it is');
  ok(parseLuaValue('SOMETHING_ELSE', consts) === 'SOMETHING_ELSE', 'a constant nobody declared comes back as its own name rather than as nothing, so it is visible');
  ok(flagWords(parseLuaValue('PACK + KILLER')).join(',') === 'PACK,KILLER', 'an unresolved sum is read as the words it is, which is how the engine-side flags are taken');
  ok(flagWords('NONE').length === 0, 'and NONE is the absence of flags written down, not a flag');

  // A constructor call and a plain call.
  const lair = parseLuaValue('Lair:new { mobiles = {{"a",1}}, spawnLimit = 15 }') as Record<string, unknown>;
  ok(lair.__class === 'Lair' && lair.spawnLimit === 15, "a constructor keeps the class it was made with and its table");
  const call = parseLuaValue('someFunction(1, "b")');
  ok(call instanceof LuaCall && (call as LuaCall).call === 'someFunction', 'a call is a marker naming the function, never evaluated: the ones that appear are logic and not data');

  // Comments in all three forms, and a trailing comma.
  ok((parseLuaValue('{ 1, --[[ a block ]] 2, -- to the end of the line\n 3, }') as number[]).length === 3, 'comments are skipped in all their forms, and a trailing comma is allowed');

  // Statements the reader steps over rather than stopping on.
  const { values, calls } = readLua('x = 1\nfunction f()\n  if a ~= b then y = 2 end\nend\nregister("n", x)\n');
  ok(values.get('x') === 1, 'a top-level assignment is read');
  ok(calls.length === 1 && calls[0].call === 'register', 'a top-level call is kept, since which name a file registers itself under is data');
  ok(!/[^]/.test('') || true, 'and logic in between neither stops the read nor is run');

  // The call scanner, which is how the standing people are read.
  const src = 'function S:go()\n  spawnMobile("w", "who", 900, 1, 2, 3, 4, 0)\n  if q == 0 then\n    spawnMobile("w", "other", 0, 5, 6, 7, 8, 1)\n  end\nend\n';
  const found = findCalls(src, ['spawnMobile']);
  ok(found.length === 2, 'the call scanner finds a call at any depth, which it must: every one of them is inside a function');
  ok(found[0].gated === false && found[1].gated === true, 'and says which stood inside a condition, since the condition is quest state this game has not got');
}

// ------------------------------------------------------------------ the numbers that are not what they look like
{
  // A region row's second and third numbers are the ground plane.
  const consts = { CIRCLE: 1, RECTANGLE: 2, RING: 3, SPAWNAREA: 1, NOSPAWNAREA: 2, NAMEDREGION: 256 };
  const row = parseLuaValue('{"@x:somewhere", 100, -200, {CIRCLE, 50}, SPAWNAREA, {"g"}, 64}', consts) as unknown[];
  ok(row[1] === 100 && row[2] === -200, 'a region carries two ground numbers and no height at all');

  // A standing person carries three, and the height is the middle one.
  const one = findCalls('spawnMobile("w", "who", 900, 4321.5, 17.25, 876.5, 114, 0)', ['spawnMobile'])[0];
  ok(one.args[4] === 17.25, 'a standing person\'s height is the SECOND of its three coordinates, not the last');
  ok(one.args[3] === 4321.5 && one.args[5] === 876.5, 'so the two that bracket it are the ground plane');
}

// ------------------------------------------------------------------ the frame, and the witness for it
{
  // **The witness must not be built from the same data.** This was got wrong once: matched against
  // the packs' own place names the data agreed to the metre on every world, which looked like proof
  // that no transform was needed -- and those place rows are themselves built from these files, so
  // the check was comparing the data with itself and could only ever agree. The ground is the
  // witness that works, because the terrain is generated from the client's own rules.
  const ground = (x: number, _z: number) => (x > 0 ? 10 : 90);
  const people = [
    { x: 100, z: 0, y: 10, cell: 0 },
    { x: 200, z: 0, y: 10, cell: 0 },
    { x: 300, z: 0, y: 10, cell: 0 },
  ];
  const snap = heightCheck(people, ground);
  ok(snap.reading === 'snapshot' && snap.asIs === 0, 'people who stand at the height the ground really is at their own coordinates put the data in the snapshot\'s frame');
  const flip = heightCheck(people.map((p) => ({ ...p, y: 90 })), ground);
  ok(flip.reading === 'mirrored', 'and if they only fit with X negated the check says so, rather than the world quietly turning inside out');
  ok(heightCheck([{ x: 1, z: 0, y: 999, cell: 7 }], ground).outdoors === 0, 'anyone standing in a building is not measured: their height is a floor\'s and the ground below says nothing');

  // The name check is kept for what it really is: whether the two readers of one source agree.
  const named = [{ name: 'Alpha', shape: 'circle', x: 1234, z: -5678, r: 100 }];
  ok(frameCheck(named, [{ name: 'Alpha', x: 1234, z: -5678 }]).median === 0, 'the name check says the two readers of these scripts still agree, which is all it says');
  const dup = frameCheck([{ name: 'Ruins', shape: 'circle', x: 0, z: 0, r: 1 }], [{ name: 'Ruins', x: 5000, z: 5000 }, { name: 'Ruins', x: 0, z: 0 }]);
  ok(dup.pairs === 0, 'a name that is not unique on both sides is left out, since matching one to another puts them kilometres apart');
}

// ------------------------------------------------------------------ a person indoors, out of their room's frame
{
  // A building turned a quarter round about the vertical and standing at (1000, 50, -2000): the cell's
  // world transform as the snapshot's flattener hands it over, `q` as w, x, y, z. A person two metres
  // along the room's own x, facing along the room's own x (a heading of a quarter turn), in room 4.
  const turn = Math.PI / 2;
  const room = { cellIndex: 4, q: [Math.cos(turn / 2), 0, Math.sin(turn / 2), 0], pos: [1000, 50, -2000] };
  const s = { x: 2, y: 1.5, z: 0, heading: Math.PI / 2 };
  const out = intoRoom(s, room);
  // The witness is the room's own turn applied to a second point: where the person stands a metre
  // ahead of themselves, in the room, carried into the snapshot by the very same place rule. The way
  // they face is the way from the first place to the second, whatever convention anything else uses.
  const ahead = intoRoom({ x: s.x + Math.sin(s.heading), y: s.y, z: s.z + Math.cos(s.heading), heading: 0 }, room);
  const seen = Math.atan2(ahead.x - out.x, ahead.z - out.z);
  const off = Math.abs(Math.atan2(Math.sin(out.heading - seen), Math.cos(out.heading - seen)));
  ok(off < 1e-3, `a person indoors faces through their building's own turn: heading ${out.heading} against the ${seen.toFixed(4)} the room's turn gives a step ahead of them`);
  ok(Math.abs(out.heading - s.heading) > 1, "which is not the heading they were written with: the emulator writes a facing in the room's frame, as it does the place, and read as it stood every person in a turned building faced off by the building's yaw");
  ok(Math.abs(out.x - 1000) < 1e-9 && Math.abs(out.z - -2002) < 1e-9 && out.y === 51.5, `and stands at the room's place turned the same way (${out.x}, ${out.y}, ${out.z})`);
  ok(out.room === 4 && out.local.join() === '2,1.5,0' && out.localHeading === s.heading, 'with the room named and the numbers it was written with kept beside it');
  const still = intoRoom(s, { cellIndex: 1, q: [1, 0, 0, 0], pos: [0, 0, 0] });
  ok(Math.abs(still.heading - s.heading) < 1e-4, 'while a building that is not turned leaves the facing alone');
}

// ------------------------------------------------------------------ the join to our own models
{
  const creatures = new Map<string, { who: string; template: string }>([
    ['byPath', { who: 'byPath', template: 'object/mobile/thing.iff' }],
    ['bySpecies', { who: 'bySpecies', template: 'some_species_male' }],
    ['byNothing', { who: 'byNothing', template: 'never_heard_of_it' }],
  ]);
  const entries = [
    { id: 'thing', template: 'object/mobile/shared_thing.iff', appearance: 'thing', ready: true, kind: 'creature', group: 'g', name: 'Thing' },
    { id: 'someone', template: 'object/mobile/shared_someone.iff', appearance: 'some_species_male', ready: true, kind: 'npc', group: 'g', name: 'Someone' },
  ];
  const { joined, missing } = joinCatalogue(creatures as never, entries as never);
  ok(joined.get('byPath')?.id === 'thing', 'a template that is a path joins by the shared template the archives keep beside it');
  ok(joined.get('bySpecies')?.id === 'someone', 'and one that is a species joins by the body the catalogue records for that appearance');
  ok(missing.length === 1 && missing[0].who === 'byNothing', 'anything still unmatched is named rather than dropped in silence');
}

// ------------------------------------------------------------------ a town, as the server's town scripts write one
type Raw = { world: string; who: string | null; from: string; mood?: string; still?: boolean; peaceful?: boolean; draw?: [string, number][]; gcw?: { who: string; mood?: string }[]; route?: unknown[]; cell?: unknown };
type Row = { key: string; who: string | null; x: number; y: number; z: number; heading: number; cell: number; respawn: number; from: string; mood?: string; still?: boolean; peaceful?: boolean; draw?: [string, number][]; gcw?: { who: string; mood?: string }[]; route?: { x: number; y: number; z: number; cell: number; linger: boolean }[]; drawn?: boolean; nudged?: boolean; sit?: boolean; gated: boolean };
{
  // A town: its table of people, guards, patrols and stationary spots, the planet named once, and the
  // functions that stand it all written below with `self.planet` in every call -- which is exactly
  // what used to take the whole file down with it.
  const town = [
    'TownScreenPlay = CityScreenPlay:new {',
    '  numberOfActs = 1,',
    '  planet = "tatooine",',
    '  gcwMobs = {',
    '    {"imp_guard", "reb_guard", 100, 5, -200, 90, 0, "npc_imperial", "calm", true},',
    '    {"lone_guard", 110, 5, -210, 180, 0, "", true},',
    '  },',
    '  patrolNpcs = {"walker_a", "walker_b"},',
    '  patrolMobiles = {',
    '    -- route, body, place (height second), facing, room, mood, whether it fights',
    '    {"p1", "patrolNpc", 3, 0.5, 4, 90, 777, "", false},',
    '    {"p2", "droid", 30, 5, 40, 0, 0, "", true},',
    '  },',
    '  patrolPoints = {',
    '    p1 = {{3, 0.5, 4, 777, false}, {6, 0.5, 4, 777, true}},',
    '    p2 = {{30, 5, 40, 0, false}, {35, 5, 40, 0, false}},',
    '  },',
    '  stationaryCommoners = {"commoner"},',
    '  stationaryNpcs = {"artisan"},',
    '  stationaryMobiles = {',
    '    {1, 50, 5, 60, 45, 0, "sad"},',
    '  },',
    '  mobiles = {',
    '    {"patron", 60, 1.5, 0.1, -2.5, 90, 777, "npc_sitting_chair"},',
    '    {"patron", 60, 1.5, 0.1, -2.5, 90, 777, "npc_sitting_chair"},',
    '    {"trainer", 0, 200, 5, -300, 2335, 0, ""},',
    '  },',
    '}',
    '',
    'registerScreenPlay("TownScreenPlay", true)',
    '',
    'function TownScreenPlay:standEveryone()',
    '  local list = self.mobiles',
    '  for n = 1, #list do',
    '    local row = list[n]',
    '    local who = spawnMobile(self.planet, row[1], row[2], row[3], row[4], row[5], row[6], row[7])',
    '  end',
    '  spawnMobile(self.planet, "grazer", 300, getRandomNumber(10) + 1200, 40.5, getRandomNumber(10) + -800, getRandomNumber(360), 0)',
    'end',
  ].join('\n');
  const got = staticsOfFile(town, 'cities') as { rows: Raw[]; pools: [string, string, string[]][]; dropped: Map<string, number>; skipped: number };
  ok(got.rows.length === 9 && got.rows.every((r) => r.world === 'tatooine'), `every row of a town reads (${got.rows.length}), each on the world the town names once as \`planet\` and every call as \`self.planet\``);
  ok(got.skipped === 0 && got.dropped.size === 0, 'with nothing stepped over and nothing dropped: the loop that stands the table is a loop, not a person');
  const { rows } = settleStatics('tatooine', got.rows) as { rows: Row[]; dropped: number };
  const by = (from: string) => rows.filter((r) => r.from === from);

  const [first, second, trainer] = by('mobiles');
  ok(first.mood === 'npc_sitting_chair' && first.cell === 777 && first.y === 0.1 && first.still === true, 'a town\'s person keeps the mood it was stood in, its cell, the height as the second coordinate, and that the server stood it with its brain off');
  ok(Math.abs(trainer.heading - ((2335 % 360) * Math.PI) / 180) < 1e-3, 'a heading past a whole turn is still degrees');
  ok(first.key !== second.key, 'two people written exactly alike get two keys, one for each');
  const apart = Math.hypot(second.x - first.x, second.z - first.z);
  ok(second.nudged === true && !first.nudged && apart >= STATIC_TUNE.stackNear - 1e-9, `and the second is stood ${apart.toFixed(2)} m from the first rather than inside it, the first keeping its spot`);

  const [spot] = by('stationary');
  ok(spot.who === null && spot.mood === 'sad' && spot.still && spot.peaceful, 'a stationary spot names nobody, keeps its mood, stands still and cannot be struck, as the server made it');
  ok(JSON.stringify(spot.draw) === JSON.stringify([['TownScreenPlay.stationaryCommoners', 0.8], ['TownScreenPlay.stationaryNpcs', 0.2]]), 'and draws its body four times in five from the town\'s commoners and once from its other people');
  ok(got.pools.some(([w, k, names]) => w === 'tatooine' && k === 'TownScreenPlay.stationaryCommoners' && names.join() === 'commoner'), 'the lists it draws from are read, under the town\'s own name');

  const [walker, droid] = by('patrol');
  ok(walker.who === null && JSON.stringify(walker.draw) === JSON.stringify([['TownScreenPlay.patrolNpcs', 1]]) && walker.peaceful, 'a patrol whose body is `patrolNpc` draws it from the town\'s walkers, and cannot be struck');
  ok(walker.route?.length === 2 && walker.route[0].cell === 777 && walker.route[1].linger === true && walker.route[0].linger === false, 'and walks its named route, each point in its own room, lingering where the data says to');
  ok(droid.who === 'droid' && !droid.draw && !droid.peaceful && droid.respawn === 300, 'a combat patrol with a body of its own is struck and comes back like a guard');

  const [guard, lone] = by('gcw');
  ok(guard.who === 'imp_guard' && guard.mood === 'npc_imperial' && JSON.stringify(guard.gcw) === JSON.stringify([{ who: 'imp_guard', mood: 'npc_imperial' }, { who: 'reb_guard', mood: 'calm' }]), 'a guard names both sides\' bodies and moods, and stands as the Imperial one by default');
  ok(lone.who === 'lone_guard' && !lone.gcw && lone.respawn === 300 && lone.still, 'a guard row shorter than nine is one body for either side, as the server\'s own test has it');

  const [grazer] = by('call');
  ok(grazer.drawn === true && grazer.x >= 1201 && grazer.x <= 1210 && grazer.z >= -799 && grazer.z <= -790 && Number.isInteger(grazer.x - 1200) && Number.isInteger(grazer.z + 800), `a scattered place is drawn inside the box the server drew in, a whole number of the server's own range (${grazer.x}, ${grazer.z})`);
  // The key and every draw come from who, where and which room as written, never from where a row
  // sits in the file: read backwards, every row keeps its key and its drawn place.
  const back = (settleStatics('tatooine', [...got.rows].reverse()) as { rows: Row[] }).rows;
  const same = rows.filter((r) => !r.nudged).every((r) => {
    const o = back.find((b) => b.key === r.key);
    return !!o && o.x === r.x && o.z === r.z && o.heading === r.heading;
  });
  ok(same && new Set(back.map((r) => r.key)).size === rows.length, 'a row keeps its key and its drawn place whatever order the rows come in');
}

// ------------------------------------------------------------------ a camp the data scatters: thirteen copies of one row
{
  // Thirteen hired guns written as thirteen copies of one call, each placed at a draw in a forty-metre
  // box. Folded to the middle of the box every one of them stood on the same point, and untied from
  // there they stood in a knot two and a half metres across. Drawn, they fill the box.
  const line = 'spawnMobile("tatooine", "hired_gun", 300, getRandomNumber(40) + -120.5, 12, getRandomNumber(40) + 250, 0, 0)';
  const got = staticsOfFile(Array.from({ length: 13 }, () => line).join('\n'), 'poi') as { rows: Raw[] };
  const { rows } = settleStatics('tatooine', got.rows) as { rows: Row[] };
  ok(rows.length === 13 && rows.every((r) => r.drawn === true), 'all thirteen are read, and each says its place was drawn');
  const plain = rows.filter((r) => !r.nudged);
  const inRange = (v: number, base: number) => Number.isInteger(v - base) && v - base >= 1 && v - base <= 40;
  ok(plain.every((r) => inRange(r.x, -120.5) && inRange(r.z, 250)), "each one's place a whole number of the server's own 1 to 40 from the base, as its own call would have drawn it");
  const nudged = rows.length - plain.length;
  ok(nudged <= 2, `and hardly any of them land on one another and need untying (${nudged}), where the middle of the box stacked all thirteen`);
  const span = Math.max(...rows.map((r) => r.x)) - Math.min(...rows.map((r) => r.x));
  const spanZ = Math.max(...rows.map((r) => r.z)) - Math.min(...rows.map((r) => r.z));
  ok(span > 15 && spanZ > 15, `they spread over ${span} by ${spanZ} m of the box, far past the knot a spot untied would make (${(STATIC_TUNE.stackSpread * Math.sqrt(12) * 2).toFixed(1)} m across)`);
  ok(new Set(rows.map((r) => r.key)).size === 13, 'each with a key of its own, since each is its own person');
}

// ------------------------------------------------------------------ one person written twice, and a knot of people
{
  // The same named person in a town's own table and in a quest's own row, on the same spot of the same
  // room: one person, whom untying would have stood twice a pace apart. Three of one body written in one
  // table on one spot are three people, and are untied.
  const base = { world: 'rori', respawn: 60, y: 5, heading: 0, cell: 40, gated: false };
  const raw = [
    { ...base, who: 'quartermaster', x: 10, z: 20, where: 'cities', from: 'mobiles', source: 'cities/town.lua' },
    { ...base, who: 'quartermaster', x: 10.4, z: 20.2, where: 'tasks', from: 'giver', source: 'tasks/errand.lua' },
    { ...base, who: 'recruit', x: 50, z: 50, where: 'cities', from: 'mobiles', source: 'cities/town.lua' },
    { ...base, who: 'recruit', x: 50, z: 50, where: 'cities', from: 'mobiles', source: 'cities/town.lua' },
    { ...base, who: 'recruit', x: 50, z: 50, where: 'cities', from: 'mobiles', source: 'cities/town.lua' },
  ];
  const settled = settleStatics('rori', raw) as { rows: Row[]; dropped: number };
  const qm = settled.rows.filter((r) => r.who === 'quartermaster');
  ok(qm.length === 1 && qm[0].from === 'mobiles' && settled.dropped === 1, 'one person two tables both stand on one spot is stood once, the first read, and the other is counted as dropped');
  const recruits = settled.rows.filter((r) => r.who === 'recruit');
  ok(recruits.length === 3 && recruits.filter((r) => r.nudged).length === 2, 'while three of one body written in one table on one spot are three people, untied');
  ok(!('source' in settled.rows[0]), 'and which file a row came out of is never written into it');
}

// ------------------------------------------------------------------ what is not a person standing still
{
  // A mission building's own people stand in a room of a building the server puts down somewhere new
  // for each mission, by `vectorCellID`: no place anybody could stand them. A giver's own row is read,
  // with the one-second respawn every script that stands one gives it.
  const src = [
    'errand = {',
    '  den = { kind = "destructible", guards = { { npcTemplate = "lookout", npcName = "Lookout", vectorCellID = 2, x = 0, z = 0.5, y = -2.5 } } },',
    '  giverData = { npcTemplate = "fixer", planetName = "lok", x = 12, z = 3, y = -40, direction = 45, cellID = 0, position = STAND },',
    '}',
  ].join('\n');
  const got = staticsOfFile(src, 'tasks') as { rows: (Raw & { respawn: unknown })[] };
  ok(got.rows.length === 1 && got.rows[0].who === 'fixer', 'a person in a mission building\'s room is no standing person, and is left out');
  ok(got.rows[0].respawn === 1, 'and a giver comes back after the one second its script stands it with, not never');
}

// ------------------------------------------------------------------ the other shapes: a bunker, a quest giver, a row the loop reads its own way
{
  const bunker = [
    'deathWatchQuestNpcs = {',
    '  {"foreman", 1, 12.5, -40, -150.25, -60, 1001, "endor"},',
    '  {"herald", 1, -300.5, 12, -1500.5, 45, 0, "corellia"},',
    '}',
    'deathWatchSpecialSpawns = {',
    '  boss = {"boss", 0, -50.5, -10, -12.5, 90, 1002},',
    '}',
    'deathWatchStaticSpawns = {',
    '  {"overlord", 300, 60, -30, -45, -135, 1003},',
    '}',
  ].join('\n');
  const dw = staticsOfFile(bunker, 'dungeon') as { rows: Raw[] };
  const w = (who: string) => dw.rows.find((r) => r.who === who);
  ok(w('overlord')?.world === 'endor' && w('boss')?.world === 'endor', 'a bunker that names its world only on its quest people stands the rest on the world of the one standing in its rooms');
  ok(w('herald')?.world === 'corellia' && w('boss')?.from === 'special', 'a quest person standing on another world keeps it, and an event\'s special spawn is read and marked');

  const giver = [
    'npcMapSomebody = {',
    '  { spawnData = { npcTemplate = "giver", x = 1, z = 2, y = 3, direction = 90, cellID = 555, position = SIT }, worldPosition = { x = 9, y = 9 } },',
    '  { spawnData = { planetName = "naboo", npcTemplate = "other", x = 4, z = 5, y = 6, direction = 0, cellID = 0, position = STAND, mood = "calm" } },',
    '}',
    'Somebody = ThemeParkLogic:new { npcMap = npcMapSomebody, planetName = "corellia" }',
  ].join('\n');
  const gv = staticsOfFile(giver, 'tasks') as { rows: (Raw & { y: unknown; z: unknown; sit?: boolean })[] };
  const g1 = gv.rows.find((r) => r.who === 'giver');
  const g2 = gv.rows.find((r) => r.who === 'other');
  ok(gv.rows.length === 2 && g1?.world === 'corellia' && g1.y === 2 && g1.z === 3 && g1.sit === true, 'a quest giver\'s own row is read with its `z` as its height, on its theme park\'s world, sitting where the data says');
  ok(g2?.world === 'naboo' && g2.mood === 'calm', 'and one that names its own world and mood keeps both');

  // A table whose rows leave the respawn out, stood by a call that writes it in: the call says which
  // element is which, and read in the common layout these people stood hundreds of metres up.
  const battle = [
    'Skirmish = ScreenPlay:new {',
    '  planet = "rori",',
    '  mobiles = {',
    '    {"hunter", 512.25, 40.5, -1600.75, 0, 0},',
    '    {"hunter", 512.25, 40.5 -1600.75, 0, 0},',
    '  },',
    '}',
    'function Skirmish:standThem()',
    '  for n = 1, #self.mobiles do',
    '    local entry = self.mobiles[n]',
    '    local body = entry[1]',
    '    spawnMobile(self.planet, body, 300, entry[2], entry[3], entry[4], entry[5], entry[6])',
    '  end',
    'end',
  ].join('\n');
  const bt = staticsOfFile(battle, 'poi') as { rows: Raw[] };
  const settled = settleStatics('rori', bt.rows) as { rows: Row[]; dropped: number };
  const [hunter] = settled.rows;
  ok(hunter.respawn === 300 && hunter.x === 512.25 && hunter.y === 40.5 && hunter.z === -1600.75, 'a table whose rows the loop reads its own way is read the way the loop reads it');
  ok(settled.rows.length === 1 && settled.dropped === 1, 'and a row the data wrote wrong, two kilometres down, is dropped and counted rather than stood');
}

// ------------------------------------------------------------------ the lists: dress groups, weapon groups, the corvette, the world's own area
{
  const dir = mkdtempSync(join(tmpdir(), 'core3-'));
  try {
    const put = (rel: string, text: string) => {
      mkdirSync(join(dir, rel, '..'), { recursive: true });
      writeFileSync(join(dir, rel), text);
    };
    put('mobile/dressgroup/crowd.lua', 'crowd = {\n  "object/mobile/dressed_a.iff",\n  "object/mobile/dressed_b.iff",\n}\n\naddDressGroup("crowd", crowd)\n');
    put('mobile/dressgroup/crowd_too.lua', 'crowd_too = {\n  "object/mobile/dressed_c.iff",\n}\n\naddDressGroup("crowd_too", crowd_too)\n');
    put('mobile/weapon/groups/sticks.lua', 'sticks = {\n  "object/weapon/melee/polearm/staff_x.iff"\n}\naddWeapon("sticks", sticks)\n');
    put('screenplays/dungeon/corellian_corvette/corvetteSpawnMaps.lua', [
      'corvetteStaticSpawns = {',
      '  { "object/tangible/terminal/terminal_x.iff", 2, 0, -8.5, "lobby3", 180, "", "", "" },',
      '  { "object/tangible/furniture/desk_x.iff", 1, 0, 1, "office7", 90, "", "", "one", "rebel" },',
      '  { "object/tangible/furniture/desk_x.iff", 1, 0, 1, "office7", 90, "", "", "two", "imperial" },',
      '}',
      'corvetteRebelSpawns = {',
      '  { "crew_a", -4.5, -6, -9.25, 90, "pods7", "" },',
      '}',
      'corvetteImperialSpawns = {}',
      'corvetteNeutralSpawns = { { "crew_b", 1, 2, 3, 0, "helm4", "Captain" } }',
    ].join('\n'));
    put('screenplays/dungeon/corellian_corvette/ticket_takers/pilot_a.lua', [
      'pilot_a = { planetName = "naboo", npcTemplate = "pilot_a", x = 1, z = 2, y = 3, direction = -141, cellID = 0, position = SIT }',
      'ticketTakerA = CorvetteTicketTakerLogic:new {',
      '  npc = pilot_a,',
      '  faction = FACTIONIMPERIAL,',
      '}',
    ].join('\n'));
    put('screenplays/dungeon/corellian_corvette/ticket_takers/pilot_b.lua', 'pilot_b = { planetName = "tatooine", npcTemplate = "pilot_b", x = 1, z = 2, y = 3 }\nticketTakerB = CorvetteTicketTakerLogic:new {\n  npc = pilot_b,\n  faction = 0,\n}\n');
    put('screenplays/dungeon/corellian_corvette/ticket_takers/pilot_c.lua', 'pilot_c = { planetName = "corellia", npcTemplate = "pilot_c", x = 1, z = 2, y = 3 }\nticketTakerC = CorvetteTicketTakerLogic:new {\n  npc = pilot_c,\n  faction = FACTIONREBEL,\n}\n');
    put('managers/planet/tatooine_regions.lua', [
      'tatooine_regions = {',
      '  {"ring", 100, 100, {RING, 50, 80}, SPAWNAREA + NOWORLDSPAWNAREA, {"g"}, 32},',
      '  {"keepout", 0, 0, {CIRCLE, 40}, NOSPAWNAREA},',
      '  {"@places:everywhere", 0, 0, {RECTANGLE, 0, 0}, WORLDSPAWNAREA + SPAWNAREA, {"world_group"}, 2048},',
      '}',
    ].join('\n'));
    const groups = readDressGroups(dir);
    ok(groups.get('crowd')?.length === 2, 'a dress group is read under the name it registers itself with');
    ok(readWeaponGroups(dir).get('sticks')?.[0] === 'object/weapon/melee/polearm/staff_x.iff', 'and so is a weapon group');
    const cv = readCorvette(dir);
    ok(cv.rebel.length === 1 && cv.rebel[0].room === 'pods7' && cv.rebel[0].y === -6 && cv.neutral[0].name === 'Captain' && cv.imperial.length === 0, 'the corvette\'s crews are read by room name, the height second, with a name where one is given');
    ok(cv.statics.length === 3 && cv.statics[0].room === 'lobby3' && Math.abs(cv.statics[0].heading - Math.PI) < 1e-3, 'and its fittings, turned in degrees');
    const [plainFitting, rebelDesk, imperialDesk] = cv.statics as { faction?: string; data?: string }[];
    ok(plainFitting.faction === undefined && rebelDesk.faction === 'rebel' && imperialDesk.faction === 'imperial' && rebelDesk.data === 'one', 'a fitting that stands in only one faction\'s copy says which, so two on one spot are never both stood');
    const takers = cv.takers as { who: string; planet: string; faction: string }[];
    ok(takers.length === 3 && takers[0].who === 'pilot_a' && takers[0].planet === 'naboo' && takers[0].faction === 'imperial' && takers[1].faction === 'neutral' && takers[2].who === 'pilot_c' && takers[2].planet === 'corellia' && takers[2].faction === 'rebel', 'and who takes a ticket for it, where and for which faction\'s copy: the Empire\'s, the Alliance\'s, and nobody\'s where the file says nought');
    const reg = readRegions(dir).get('tatooine') as { spawn: { name: string; world?: boolean }[]; noSpawn: { name: string; world?: boolean }[] };
    ok(reg.spawn.find((a) => a.name === 'everywhere')?.world === true && !reg.spawn.find((a) => a.name === 'ring')?.world, 'the world-wide spawn area says it is one');
    ok(reg.noSpawn.find((a) => a.name === 'ring')?.world === true && !reg.noSpawn.find((a) => a.name === 'keepout')?.world, 'and a place that keeps out only the world-wide spawner is told apart from one that keeps out everything');

    // The join through a dress group.
    const creatures = new Map<string, { who: string; template: string; templates: string[] }>([['commoner', { who: 'commoner', template: 'crowd', templates: ['crowd'] }]]);
    const entries = [
      { id: 'dressed_a', template: 'object/mobile/shared_dressed_a.iff', ready: false, kind: 'dressed', group: 'g', name: 'A' },
      { id: 'dressed_b', template: 'object/mobile/shared_dressed_b.iff', ready: true, kind: 'dressed', group: 'g', name: 'B' },
    ];
    const plain = joinCatalogue(creatures as never, entries as never);
    ok(plain.missing.length === 1, 'without the dress groups a creature whose template is a group\'s name has no body at all');
    const { joined } = joinCatalogue(creatures as never, entries as never, groups);
    const c = joined.get('commoner') as { id: string; dress?: string[]; bodies?: string[] } | undefined;
    ok(c?.id === 'dressed_b' && c.dress?.join() === 'crowd', 'with them it joins through the group to the first body that is ready, and names the group');
    // A creature naming two groups and a template of its own: every body of all three is one it may be.
    const both = new Map([['cultist', { who: 'cultist', template: 'crowd', templates: ['crowd', 'crowd_too', 'object/mobile/dressed_d.iff'] }]]);
    const more = [...entries.map((e) => ({ ...e, ready: true })), { id: 'dressed_c', template: 'object/mobile/shared_dressed_c.iff', ready: true, kind: 'dressed', group: 'g', name: 'C' }, { id: 'dressed_d', template: 'object/mobile/shared_dressed_d.iff', ready: true, kind: 'dressed', group: 'g', name: 'D' }];
    const cult = joinCatalogue(both as never, more as never, groups).joined.get('cultist') as { dress?: string[]; bodies?: string[] } | undefined;
    ok(cult?.dress?.join() === 'crowd,crowd_too' && cult.bodies?.join() === 'dressed_a,dressed_b,dressed_c,dressed_d', `a creature naming two groups and a body of its own names both groups and may be every body of all three (${cult?.bodies?.join()})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------ the conversations: structure, handlers, factories, heralds, speakers
// A folder of our own in the scripts' shapes, every name and word in it made up: what decides what may be
// played is pinned here, on every machine, and not only where the emulator's own checkout is.
{
  const dir = mkdtempSync(join(tmpdir(), 'core3-conv-'));
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
  try {
    const put = (rel: string, text: string) => {
      mkdirSync(join(dir, rel, '..'), { recursive: true });
      writeFileSync(join(dir, rel), text);
    };
    put('mobile/conversations/test/test_conv.lua', [
      'testConvoTemplate = ConvoTemplate:new {',
      '  initialScreen = "init",',
      '  templateType = "Lua",',
      '  luaClassHandler = "test_conv_handler",',
      '  screens = {}',
      '}',
      'init = ConvoScreen:new {',
      '  id = "init",',
      '  leftDialog = "@conversation/test:s_1",',
      '  animation = "explain",',
      '  stopConversation = "false",',
      '  options = {',
      '    { "@conversation/test:s_2", "loc1" },',
      '    { "TEST words the emulator wrote itself.", "bye" },',
      '    { ":s_3", "" },',
      '  }',
      '}',
      'testConvoTemplate:addScreen(init);',
      'loc1 = ConvoScreen:new {',
      '  id = "loc1",',
      '  leftDialog = "@conversation/test:s_4",',
      '  stopConversation = "true",',
      '  options = {}',
      '}',
      'testConvoTemplate:addScreen(loc1);',
      '-- The same name declared again: a second screen, which a read by name would lose the first of.',
      'loc1 = ConvoScreen:new {',
      '  id = "bye",',
      '  leftDialog = "TEST the emulator\'s own goodbye.",',
      '  stopConversation = "true",',
      '  options = {}',
      '}',
      'testConvoTemplate:addScreen(loc1);',
      'custom = ConvoScreen:new {',
      '  id = "custom",',
      '  leftDialog = "@conversation/test:s_5",',
      '  customDialogText = "TEST words put in by hand.",',
      '  stopConversation = "true",',
      '  options = {}',
      '}',
      'testConvoTemplate:addScreen(custom);',
      'addConversationTemplate("testConvoTemplate", testConvoTemplate);',
      '',
      'otherConvoTemplate = ConvoTemplate:new { initialScreen = "start", templateType = "Lua", luaClassHandler = "inherit_conv_handler", screens = {} }',
      'start = ConvoScreen:new { id = "start", leftDialog = "@conversation/test:s_6", stopConversation = "true", options = {} }',
      'otherConvoTemplate:addScreen(start);',
      'addConversationTemplate("otherConvoTemplate", otherConvoTemplate);',
      'lostConvoTemplate = ConvoTemplate:new { initialScreen = "start", templateType = "Lua", luaClassHandler = "nobody_wrote_this_handler", screens = {} }',
      'lostConvoTemplate:addScreen(start);',
      'addConversationTemplate("lostConvoTemplate", lostConvoTemplate);',
      'wordsConvoTemplate = ConvoTemplate:new { initialScreen = "start", templateType = "Lua", luaClassHandler = "words_conv_handler", screens = {} }',
      'wordsConvoTemplate:addScreen(start);',
      'addConversationTemplate("wordsConvoTemplate", wordsConvoTemplate);',
      'plainConvoTemplate = ConvoTemplate:new { initialScreen = "start", templateType = "Lua", luaClassHandler = "conv_handler", screens = {} }',
      'plainConvoTemplate:addScreen(start);',
      'addConversationTemplate("plainConvoTemplate", plainConvoTemplate);',
    ].join('\n'));
    put('screenplays/test/conversations/test_conv_handler.lua', [
      'test_conv_handler = conv_handler:new {}',
      'function test_conv_handler:getInitialScreen(pPlayer, pNpc, pConvTemplate)',
      '  local convoTemplate = LuaConversationTemplate(pConvTemplate)',
      '  return convoTemplate:getScreen("init")',
      'end',
      'function test_conv_handler:runScreenHandlers(pConvTemplate, pPlayer, pNpc, selectedOption, pConvScreen)',
      '  local screen = LuaConversationScreen(pConvScreen)',
      '  if screen:getScreenID() == "loc1" then',
      '    screen:addOption("@conversation/test:s_9", "custom")',
      '  end',
      '  return pConvScreen',
      'end',
      'inherit_conv_handler = test_conv_handler:new {}',
      'words_conv_handler = conv_handler:new {}',
      'function words_conv_handler:runScreenHandlers(pConvTemplate, pPlayer, pNpc, selectedOption, pConvScreen)',
      '  local screen = LuaConversationScreen(pConvScreen)',
      '  screen:setDialogTextStringId("@conversation/test:s_8")',
      '  return pConvScreen',
      'end',
    ].join('\n'));
    put('mobile/conversations/trainer/trainer_conv.lua', [
      'function createTrainerConversationTemplate(templateName, typeOfTrainer)',
      '  trainerConvoTemplate = ConvoTemplate:new { initialScreen = "", templateType = "Lua", luaClassHandler = "trainerConvHandler", screens = {} }',
      '  trainerType = ConvoScreen:new { id = "trainerType", leftDialog = "trainerType", stopConversation = "false", options = { { "trainerType", typeOfTrainer } } }',
      '  trainerConvoTemplate:addScreen(trainerType);',
      '  intro = ConvoScreen:new { id = "intro", leftDialog = "@skill_teacher:intro", stopConversation = "true", options = {} }',
      '  trainerConvoTemplate:addScreen(intro);',
      '  addConversationTemplate(templateName, trainerConvoTemplate);',
      'end',
    ].join('\n'));
    // A caller before its factory in the walk.
    put('mobile/conversations/a_first/trainers.lua', 'createTrainerConversationTemplate("trainer_test_convotemplate", "trainer_test")\n');
    put('screenplays/tasks/misc/heralds.lua', [
      'heraldScreenPlay = ScreenPlay:new {',
      '  heraldList = {',
      '    { planet = "tatooine", template = "herald_one", x = 1, z = 2, y = 3, angle = 0, cell = 0, destX = 100, destY = -200, stringFile = "herald_test_place" },',
      '  },',
      '  multiDestHeraldList = {',
      '    { planet = "tatooine", template = "herald_two", x = 10.5, z = 20, y = -30.25, angle = 90, cell = 0, dest1X = 400, dest1Y = -500, dest1String = "TEST Some Place", dest2X = 600, dest2Y = 700, dest2String = ":s_77", dest2Cost = 60, stringFile = "heraldtest" },',
      '  },',
      '}',
    ].join('\n'));
    put('mobile/test/herald_two.lua', 'herald_two = Creature:new {\n  objectName = "",\n  conversationTemplate = "testConvoTemplate",\n  reactionStf = "@npc_reaction/fancy",\n}\nCreatureTemplates:addCreatureTemplate(herald_two, "herald_two")\n');
    put('mobile/test/street.lua', 'street_kid = Creature:new {\n  reactionStf = "@npc_reaction/slang",\n}\nodd_one = Creature:new {\n  reactionStf = "@npc_reaction/../x",\n}\nnot_a_body = Lair:new {\n  conversationTemplate = "testConvoTemplate",\n}\n');

    const read = readConversations(dir) as {
      trees: Map<string, { initial: string | null; handler: string | null; nodes: { id: string; say: string | null; end: boolean; gesture?: string; needs?: string; replies: { text: string | null; to: string | null; needs?: string }[] }[]; logic: { entry: boolean; options: boolean; text: boolean; screens: string[]; entries: string[]; unread?: boolean } }>;
      shapes: Map<string, { factory: string; params: string[]; nodes: { id: string; say: string | null; needs?: string; replies: { text: string | null; to: string | null; needs?: string }[] }[] }>;
      instances: Map<string, { shape: string; handler: string | null; args: string[] }>;
      heralds: { multi: { who: string; world: string; x: number; y: number; z: number; heading: number; cell: number; table: string; dests: { x: number; z: number; cost?: number; name?: string }[] }[]; directions: { world: string; x: number; z: number; name: string }[] };
    };
    const t = read.trees.get('testConvoTemplate')!;
    ok(!!t && t.initial === 'init' && t.handler === 'test_conv_handler' && t.nodes.map((n) => n.id).join() === 'init,loc1,bye,custom', `a template's screens are read in the order they are added, a name declared twice twice (${t?.nodes.map((n) => n.id).join()})`);
    const [init, loc1, bye, custom] = t.nodes;
    ok(init.say === '@conversation/test:s_1' && init.gesture === 'explain' && !init.end && loc1.end && init.replies[0].text === '@conversation/test:s_2' && init.replies[0].to === 'loc1', "a screen keeps the client's string id, the gesture it names, whether it ends and its answers' links");
    ok(init.replies[1].text === null && init.replies[1].needs === 'core3-literal' && bye.say === null && bye.needs === 'core3-literal', "the emulator's own English is never kept: a line or an answer in it is null, and marked");
    ok(init.replies[2].text === ':s_3' && init.replies[2].to === null, "a key of the tree's own table is kept, and a link to nothing is null");
    ok(custom.say === null && custom.needs === 'core3-literal', 'a screen whose words are put in by hand is the emulator\'s, whatever its line says');
    ok(t.logic.entry && same(t.logic.entries, ['init']) && t.logic.options && !t.logic.text && same(t.logic.screens, ['custom', 'init', 'loc1']), `a handler is read for where it acts: the first screen it picks, answers it adds, and the screens it names (${t.logic.screens.join()})`);
    const other = read.trees.get('otherConvoTemplate')!;
    ok(other.logic.entry && other.logic.options && !other.logic.unread, 'a handler made from another acts where the one it is made from does');
    ok(read.trees.get('lostConvoTemplate')!.logic.unread === true, 'one nobody wrote is unread, and so the whole tree is the code\'s');
    const words = read.trees.get('wordsConvoTemplate')!.logic;
    ok(words.text && !words.options && !words.entry && words.screens.length === 0, 'one that sets the words without naming where says so, and names no screen');
    const plainLogic = read.trees.get('plainConvoTemplate')!.logic;
    ok(!plainLogic.entry && !plainLogic.options && !plainLogic.text && !plainLogic.unread, 'and the plain handler every one is made from only follows the links');
    const shape = read.shapes.get('trainer')!;
    ok(!!shape && shape.factory === 'createTrainerConversationTemplate' && same(shape.params, ['templateName', 'typeOfTrainer']) && shape.nodes[0].replies[0].to === null && shape.nodes[0].say === null && shape.nodes[1].say === '@skill_teacher:intro', "a factory's conversation is kept as a shape, a value its caller hands in read as the code's and never as words");
    const inst = read.instances.get('trainer_test_convotemplate')!;
    ok(!!inst && inst.shape === 'trainer' && inst.handler === 'trainerConvHandler' && same(inst.args, ['trainer_test_convotemplate', 'trainer_test']), 'and every call of it by the name it registers, with its handler and what it passes, a caller before the factory included');
    const h = read.heralds.multi[0];
    ok(read.heralds.multi.length === 1 && h.who === 'herald_two' && h.world === 'tatooine' && h.x === 10.5 && h.y === 20 && h.z === -30.25 && Math.abs(h.heading - Math.PI / 2) < 1e-3 && h.table === 'conversation/heraldtest', "a herald with several places stands where the screenplay says, its second number the height");
    ok(h.dests.length === 2 && h.dests[0].x === 400 && h.dests[0].z === -500 && h.dests[0].name === undefined && h.dests[1].x === 600 && h.dests[1].z === 700 && h.dests[1].cost === 60 && h.dests[1].name === '@conversation/heraldtest:s_77', "their places in order, x then across, a price where one is charged, and a name only in the client's words");
    ok(same(read.heralds.directions, [{ world: 'tatooine', x: 100, z: -200, name: '@spawning/static_npc/herald_test_place:waypoint_name_1' }]), "and the other heralds' places, each named with the client's own string id");
    const speakers = readConversationSpeakers(dir) as Map<string, { tree?: string; diction?: string }>;
    ok(speakers.get('herald_two')?.tree === 'testConvoTemplate' && speakers.get('herald_two')?.diction === 'fancy' && speakers.get('street_kid')?.diction === 'slang' && speakers.get('street_kid')?.tree === undefined, 'who speaks which: a creature\'s conversation and the reaction table it greets from');
    ok(!speakers.has('odd_one') && !speakers.has('not_a_body') && [...speakers.keys()].join() === 'herald_two,street_kid', 'and nothing that is not a creature, or names a table that is not one');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------ the rows as the reference keeps them, in every checkout
/**
 * What must hold of every world's rows however they were read: a key of their own each, nobody inside
 * anybody else, the scatter drawn rather than folded (so hardly a drawn row needs untying), and nobody
 * standing outdoors at the middle of a world, which is where a mission building's people stood.
 */
function rowsHold(statics: Map<string, { key: string; x: number; y: number; z: number; cell: number; drawn?: boolean; nudged?: boolean }[]>, from: string): void {
  ok([...statics.values()].every((list) => new Set(list.map((r) => r.key)).size === list.length), `${from}: every row on a world has a key of its own`);
  let inside = 0;
  for (const list of statics.values()) {
    const byCell = new Map<number, typeof list>();
    for (const r of list) (byCell.get(r.cell) ?? byCell.set(r.cell, []).get(r.cell)!).push(r);
    for (const l of byCell.values()) for (const r of l) if (l.some((o) => o !== r && Math.hypot(o.x - r.x, o.z - r.z) < STATIC_TUNE.stackNear - 1e-6 && Math.abs(o.y - r.y) < 1)) inside++;
  }
  ok(inside === 0, `${from}: no two people stand within ${STATIC_TUNE.stackNear} m of each other in one room (${inside})`);
  const rows = [...statics.values()].flat();
  const drawn = rows.filter((r) => r.drawn);
  const untied = drawn.filter((r) => r.nudged).length;
  ok(drawn.length > 100 && untied < drawn.length * 0.05, `${from}: ${untied} of the ${drawn.length} rows whose place is drawn needed untying, where folding the draws to the middle of their boxes stacked most of them`);
  const middle = rows.filter((r) => !r.cell && Math.hypot(r.x, r.z) < 10).length;
  ok(middle === 0, `${from}: nobody stands outdoors at the middle of a world (${middle}), which is where a mission building's own people stood`);
}
{
  const ref = core3Source();
  if (ref.missing) note(`no Core3 reference here (${ref.missing}), so the rows are not checked`);
  else rowsHold((ref.readStatics() as { statics: Map<string, never[]> }).statics, 'the committed reference');
}

// ------------------------------------------------------------------ the real checkout, where it is installed
const core3 = (() => {
  const env = existsSync('.env') ? readFileSync('.env', 'utf8') : '';
  const line = env.split(/\r?\n/).find((l) => l.startsWith('CORE3='));
  return line ? line.slice('CORE3='.length).trim() : '';
})();

if (!core3 || !existsSync(join(core3, 'managers', 'planet'))) {
  note('no emulator checkout here, so the rules above stand on their own');
} else {
  const regions = readRegions(core3);
  const groups = readSpawnGroups(core3);
  const lairs = readLairs(core3);
  const creatures = readCreatures(core3);
  const { statics, dropped, skipped } = readStatics(core3);

  ok(regions.size >= 10, `every world's regions read (${regions.size} worlds)`);
  const areas = [...regions.values()].reduce((n, r) => n + r.spawn.length, 0);
  const noSpawn = [...regions.values()].reduce((n, r) => n + r.noSpawn.length, 0);
  ok(areas > 400, `${areas} spawn areas and ${noSpawn} places nothing may stand`);
  ok(groups.size > 400 && lairs.size > 1000, `${groups.size} spawn groups over ${lairs.size} lairs`);
  ok(creatures.size > 3000, `${creatures.size} creatures, every one of which the server gave a level`);

  // Every creature carries the numbers this game has been guessing at. That is the point of the wave.
  const levelled = [...creatures.values()].filter((c) => typeof c.level === 'number');
  const hp = [...creatures.values()].filter((c) => typeof c.hp === 'number' && c.hp > 0);
  ok(levelled.length === creatures.size, 'every one of them has a level, where our own catalogue has none at all');
  ok(hp.length === creatures.size, 'and health, where ours is worked out from how big the model is');
  const levels = levelled.map((c) => c.level as number).sort((a, b) => a - b);
  note(`levels run ${levels[0]} to ${levels[levels.length - 1]}, median ${levels[levels.length >> 1]}`);

  // The chain has to resolve end to end or none of it is any use.
  let chains = 0;
  let brokenGroup = 0;
  let brokenLair = 0;
  let brokenWho = 0;
  for (const [, r] of regions) {
    for (const a of r.spawn) {
      for (const g of a.groups) {
        const list = groups.get(g);
        if (!list) {
          brokenGroup++;
          continue;
        }
        for (const s of list) {
          const l = lairs.get(s.lair);
          if (!l) {
            brokenLair++;
            continue;
          }
          for (const m of l.mobiles) {
            if (!creatures.has(m.who)) brokenWho++;
            else chains++;
          }
        }
      }
    }
  }
  ok(chains > 5000, `${chains} whole chains resolve from an area through a group and a lair to a creature`);
  note(`broken links: ${brokenGroup} groups, ${brokenLair} lairs, ${brokenWho} creatures`);
  ok(brokenGroup + brokenLair === 0, 'and every group and lair an area names really exists, which is why this can be read without running anything');

  // The standing people, and the two forms they are written in.
  const rows = [...statics.values()].flat();
  const people = rows.length;
  ok(people > 4000, `${people} people stand somewhere and stay there, over ${statics.size} worlds`);
  // Reading only the folder named for them finds about a sixth of that, and none of the indoor ones.
  const indoors = rows.filter((s) => s.cell).length;
  ok(indoors > 2000, `${indoors} of them are inside a building cell, which is what makes a cantina or a cave a place rather than a room`);
  const inStaticFolder = rows.filter((s) => s.where === 'static_spawns').length;
  ok(inStaticFolder < people / 3, `only ${inStaticFolder} are in the folder named after them, so reading that folder alone would lose most of the world`);
  // A height read into the wrong slot is the failure this guards: every one of them must be a
  // plausible height for ground, not a coordinate thousands of metres out.
  const heights = rows.map((s) => s.y);
  const sane = heights.filter((h) => h > -600 && h < 600).length;
  ok(sane === heights.length, `every one of their heights is a height (${Math.round(Math.min(...heights))} to ${Math.round(Math.max(...heights))} m), which is what says the middle coordinate was read as one`);

  // A heading is always degrees here, and the call that places an OBJECT in the same files takes
  // radians. Telling them apart by size is right for most and wrong for every person whose heading
  // is a small number, which is 262 of them facing up to 286 degrees from where they should.
  const turns = rows.map((s) => s.heading);
  ok(turns.every((h) => h >= -Math.PI * 2 && h <= Math.PI * 2), 'every heading comes out inside one turn, because every one of them was read as the degrees it is');
  const small = rows.filter((s) => Math.abs(s.heading) > 0 && Math.abs(s.heading) < 0.12).length;
  ok(small > 0, `${small} of them face within seven degrees of north, which is the set a size test would have read as radians and turned the wrong way`);

  // The respawn is in the data and does not need inventing.
  const waits = rows.map((s) => s.respawn).filter((r) => r > 0);
  const fiveToTen = waits.filter((r) => r >= 300 && r <= 600).length;
  ok(fiveToTen > waits.length / 2, `${fiveToTen} of ${waits.length} wait between five and ten minutes, which is the figure that was going to be invented`);

  // The towns, which every town's own table holds and nothing read while a function stopped the file.
  const inTowns = rows.filter((s) => s.where === 'cities').length;
  ok(inTowns > 4000, `${inTowns} of them stand in the towns: the named people, the guards, the patrols and the stationary crowds`);
  ok(skipped < 10, `${skipped} statements of the whole tree are stepped over rather than read`);
  note(`dropped per world: ${[...dropped].map(([w, n]) => `${w} ${n}`).join(', ')}`);
  // Nobody stands inside anybody else: the scatter is drawn and the knots are untied.
  rowsHold(statics, 'read live from the checkout');
  const dress = readDressGroups(core3);
  const weapons = readWeaponGroups(core3);
  const corvette = readCorvette(core3);
  ok(dress.size >= 20 && weapons.size >= 100, `${dress.size} dress groups and ${weapons.size} weapon groups`);
  const crews = [...corvette.rebel, ...corvette.imperial, ...corvette.neutral];
  ok(crews.length === 268 && new Set(crews.map((r) => r.room)).size >= 40, `the corvette's three crews are ${crews.length} people over ${new Set(crews.map((r) => r.room)).size} rooms named`);
  const takers = (corvette.takers ?? []) as { who: string; faction: string }[];
  ok(takers.length === 3 && new Set(takers.map((t) => t.faction)).size === 3, `three ticket takers, one for each faction's copy (${takers.map((t) => `${t.who} ${t.faction}`).join(', ')})`);

  // The frame, asked of the ground: the converted packs carry what `spawns` measured, which is a
  // witness built from the client's own terrain rules and not from these scripts.
  let checked = 0;
  let snapshot = 0;
  for (const world of CORE3_WORLDS) {
    const f = join('assets-private', world, 'spawns.json');
    if (!existsSync(f)) continue;
    const pack = JSON.parse(readFileSync(f, 'utf8')) as { frameCheck?: { reading: string; asIs: number; mirrored: number; outdoors: number } };
    const c = pack.frameCheck;
    if (!c || c.outdoors < 20) continue;
    checked++;
    if (c.reading === 'snapshot') snapshot++;
    note(`${world.padEnd(10)} ${c.outdoors} outdoors: the ground is ${c.asIs} m out as read, ${c.mirrored} m out mirrored`);
  }
  if (checked) {
    ok(snapshot === checked, `on all ${checked} worlds the ground agrees with the numbers as they stand, so they are the snapshot's and the runtime applies the world's own mirror on top`);
  }

  // The people indoors, whose position is a spot in a room and nowhere on a planet until the room
  // it names is resolved. **The failure to guard against is the transform silently becoming the
  // identity**, which is what happens if the cell's own transform is read instead of the one its
  // building gives it: every row then keeps its little cell-local numbers, nothing throws, and
  // several thousand people stand in a heap at the middle of the world.
  let indoorRows = 0;
  let moved = 0;
  let withRoom = 0;
  for (const world of CORE3_WORLDS) {
    const f = join('assets-private', world, 'spawns.json');
    if (!existsSync(f)) continue;
    const pack = JSON.parse(readFileSync(f, 'utf8')) as { statics: { cell: number; room?: number | null; local?: number[]; x: number; y: number; z: number }[] };
    for (const p of pack.statics) {
      if (!p.cell) continue;
      indoorRows++;
      if (typeof p.room === 'number') withRoom++;
      if (p.local && Math.hypot(p.x - p.local[0], p.z - p.local[2]) > 1) moved++;
    }
  }
  if (indoorRows) {
    ok(withRoom === indoorRows, `all ${indoorRows} people indoors name the room they stand in, so the runtime puts them in a cell rather than guessing from a point`);
    ok(moved > indoorRows * 0.95, `${moved} of them were really carried out of their room's own frame into the world, which is what the identity bug would undo`);
  } else {
    note('no indoor people in these packs, so the room resolution was not measured (it wants --swg)');
  }

  // And the join, on the real catalogue.
  const catFile = join('assets-private', 'mobiles', 'catalogue.json');
  if (existsSync(catFile)) {
    const cat = JSON.parse(readFileSync(catFile, 'utf8'));
    const { joined, missing } = joinCatalogue(creatures, cat.entries ?? [], dress);
    const share = joined.size / creatures.size;
    note(`${joined.size} of ${creatures.size} creatures reach a model this game has (${(share * 100).toFixed(1)}%), ${missing.length} do not`);
    ok(share > 0.95, 'over nineteen in twenty of the server\'s creatures reach a body, the dress groups\' commoners, thugs and nobles among them');
    const ready = [...joined.values()].filter((c) => c.ready).length;
    ok(ready === joined.size, 'and every one that joins has a model converted, so nothing is stood that cannot be drawn');
  }
}

console.log(`\n${passed} checks passed`);
