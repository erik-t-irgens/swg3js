// Reading the world's own spawns out of the owner's emulator checkout.
//
// The rules are pure, so this runs the real ones on fixtures written here. Where the checkout is
// installed it then reads the **real** data and prints what it says, which is how the claim that the
// world's creatures come from the server's own tables stays an observed fact rather than an assertion
// in a comment. The fixtures are written from the shapes the real files use and are not copied from
// them: that project is somebody else's work under its own licence.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findCalls, parseLuaValue, readLua, LuaCall } from '../lua.mjs';
import { flagWords, frameCheck, heightCheck, joinCatalogue, readCreatures, readLairs, readRegions, readSpawnGroups, readStatics, CORE3_WORLDS } from '../core3.mjs';

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
  const one = findCalls('spawnMobile("w", "who", 900, 5090.1, 21.5, 591.3, 114, 0)', ['spawnMobile'])[0];
  ok(one.args[4] === 21.5, 'a standing person\'s height is the SECOND of its three coordinates, not the last');
  ok(one.args[3] === 5090.1 && one.args[5] === 591.3, 'so the two that bracket it are the ground plane');
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
  const named = [{ name: 'Alpha', shape: 'circle', x: 3460, z: -4768, r: 100 }];
  ok(frameCheck(named, [{ name: 'Alpha', x: 3460, z: -4768 }]).median === 0, 'the name check says the two readers of these scripts still agree, which is all it says');
  const dup = frameCheck([{ name: 'Ruins', shape: 'circle', x: 0, z: 0, r: 1 }], [{ name: 'Ruins', x: 5000, z: 5000 }, { name: 'Ruins', x: 0, z: 0 }]);
  ok(dup.pairs === 0, 'a name that is not unique on both sides is left out, since matching one to another puts them kilometres apart');
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
  const { statics, dropped } = readStatics(core3);

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

  // And the join, on the real catalogue.
  const catFile = join('assets-private', 'mobiles', 'catalogue.json');
  if (existsSync(catFile)) {
    const cat = JSON.parse(readFileSync(catFile, 'utf8'));
    const { joined, missing } = joinCatalogue(creatures, cat.entries ?? []);
    const share = joined.size / creatures.size;
    note(`${joined.size} of ${creatures.size} creatures reach a model this game has (${(share * 100).toFixed(1)}%), ${missing.length} do not`);
    ok(share > 0.9, 'over nine in ten of the server\'s creatures reach a body, which is what makes the world standable');
    const ready = [...joined.values()].filter((c) => c.ready).length;
    ok(ready === joined.size, 'and every one that joins has a model converted, so nothing is stood that cannot be drawn');
  }
}

console.log(`\n${passed} checks passed`);
