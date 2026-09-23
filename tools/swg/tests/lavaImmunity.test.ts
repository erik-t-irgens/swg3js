// Who a flow cannot hurt: reading the client's own list out of a converted pack, reducing both
// spellings of a template to one key, the join itself, and the one report the owner reads to know
// whether the two spellings meet. Pure, so this runs exactly what the game runs; every name below is
// made up for the test, because the client's own list belongs in the archives and in the pack and
// nowhere in this repository.
//
// There is not a number in the file under test. The list is the client's; the key (the file's own
// name, without `shared_` and without the extension) is ours, and is what these checks pin.
//
// It reaches across the wave on purpose, in two places, because those are the seams a rename would
// break in silence: the converter's own row shape (the water command writes rows, not strings) and
// `readWaterPack`, which builds its own record of a pack and must carry the block through.
import assert from 'node:assert/strict';
import {
  NO_LAVA_IMMUNITY,
  immunityKey,
  isLavaImmune,
  joinImmunity,
  lavaImmunity,
  lavaImmunityOf,
  lavaImmuneTemplate,
  packNamesImmunity,
  setImmunityCatalogue,
  setLavaImmunity,
} from '../../../src/world/lavaImmunity.ts';
import { lavaImmuneTemplates } from '../../../src/world/lavaHarmMath.ts';
import { readWaterPack } from '../../../src/world/waterLook.ts';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};
const same = (a: unknown, b: unknown, msg: string) => {
  assert.deepEqual(a, b, msg);
  passed++;
  console.log(`ok   ${msg}`);
};

/** What the console said while `fn` ran. The report is the deliverable, so it is read, not assumed. */
function heard(fn: () => void): { info: string[]; warn: string[] } {
  const info: string[] = [];
  const warn: string[] = [];
  const oldInfo = console.info;
  const oldWarn = console.warn;
  console.info = (...a: unknown[]) => void info.push(a.join(' '));
  console.warn = (...a: unknown[]) => void warn.push(a.join(' '));
  try {
    fn();
  } finally {
    console.info = oldInfo;
    console.warn = oldWarn;
  }
  return { info, warn };
}

// --- the key --------------------------------------------------------------------------------------

// The whole join rests on this: the client's table spells a template one way and the packs convert
// it another, and the file's own name is the only part the two spellings share.
ok(immunityKey('object/mobile/vehicle/flow_skiff.iff') === 'flow_skiff', "the client's spelling reduces to the file's own name");
ok(immunityKey('object/mobile/vehicle/shared_flow_skiff.iff') === 'flow_skiff', "the pack's spelling reduces to the same name");
ok(immunityKey('object/mobile/vehicle/flow_skiff.iff') === immunityKey('object/mobile/vehicle/shared_flow_skiff.iff'), 'which is to say the two meet');
ok(immunityKey('object\\mobile\\vehicle\\shared_flow_skiff.iff') === 'flow_skiff', 'a path written with backslashes reduces the same way');
ok(immunityKey('OBJECT/Mobile/Vehicle/Shared_Flow_Skiff.IFF') === 'flow_skiff', 'case is not part of the key, on either side');
ok(immunityKey('flow_skiff') === 'flow_skiff', 'a bare name with no folder and no extension is already the key');
ok(immunityKey('  object/mobile/vehicle/flow_skiff.iff  ') === 'flow_skiff', 'the spaces a hand-written list picks up are not part of the key');
ok(immunityKey('shared_shared_hopper.iff') === 'shared_hopper', 'only the one leading prefix comes off: a name that really begins with it keeps it');
for (const bad of [null, undefined, '', '   ', 42, {}, [], true]) {
  assert.equal(immunityKey(bad as string | null | undefined), '', `nothing is a key: ${JSON.stringify(bad) ?? String(bad)}`);
}
ok(true, 'null, undefined, an empty name and anything that is not a string are no key at all');

// --- the converter's own rows, as it really writes them ---------------------------------------------

// This is the seam between the two packages: the water command writes the client's table as rows
// (the server template it names, the `shared_` sibling where the archives hold one, the file's own
// stem and the resistance column), never as bare strings. Rename a field there and these fail here,
// which is the whole point of pinning the shape rather than a string.
const row = (name: string, shared: string | null) => ({ template: `object/mobile/vehicle/${name}.iff`, shared, id: name, resistance: 100 });
const packRows = [
  row('flow_skiff', 'object/mobile/vehicle/shared_flow_skiff.iff'),
  row('high_hopper', 'object/mobile/vehicle/shared_high_hopper.iff'),
  // A row whose shared sibling is not in the archives: the converter keeps it as a miss rather than
  // dropping it, since its own name may still join to something a pack holds.
  row('ash_walker', null),
];
const pack = {
  version: 1,
  planet: 'somewhere',
  global: null,
  harm: { source: 'client', files: { types: 'a.iff', immune: 'b.iff' }, typeFrom: 'row', types: [{ type: 1, damage: true, kills: true, intervalSeconds: 1, percent: 35, share: 0.35 }], immune: packRows },
  shaders: {},
  notes: [],
};

const named = lavaImmuneTemplates(pack);
same(named, packRows.map((r) => r.template), "the block's one parser reads the converter's rows as the names they carry");
same(named.map(immunityKey), ['flow_skiff', 'high_hopper', 'ash_walker'], 'and every one of those names reduces to the key a hull joins on');
ok(packNamesImmunity(pack), 'the probe sees the list beside the rest of what a water type does');
ok(!packNamesImmunity({ ...pack, harm: { source: 'client', types: [] } }), 'a harm block with no list at all is a pack that says nothing about immunity');
ok(packNamesImmunity({ ...pack, harm: { immune: [] } }) && lavaImmuneTemplates({ ...pack, harm: { immune: [] } }).length === 0, 'an empty list is an answer: the pack carries the list and it names nobody');
ok(packNamesImmunity({ harm: { immune: { templates: ['a.iff'] } } }), 'the other shape the parser takes is seen by the probe too');
for (const junk of [null, undefined, 42, 'water.json', [], true, {}, { harm: 7 }, { harm: { immune: 'flow_skiff' } }]) {
  assert.equal(packNamesImmunity(junk), false, `nothing to see: ${JSON.stringify(junk) ?? String(junk)}`);
  assert.deepEqual(lavaImmuneTemplates(junk), [], `and nothing to read: ${JSON.stringify(junk) ?? String(junk)}`);
}
ok(true, 'anything that is not a pack with a list answers false and reads as no names, so the two never disagree');

// `readWaterPack` builds its own record of a pack rather than handing the file on, so the block has
// to be carried through it deliberately. Everything downstream -- the numbers a burn applies as well
// as this list -- is read off that record, and a block dropped there is a block the game never sees.
{
  const read = readWaterPack({ ...pack, shaders: { wter_a: { kind: 'lava', waterTypes: [1], tables: 1, global: false } } })!;
  ok(read !== null && read.harm !== undefined, "the pack's harm block survives the way in");
  same(lavaImmuneTemplates(read), packRows.map((r) => r.template), 'and reads the same through the record as it does off the raw file');
  ok(readWaterPack({ version: 1, shaders: {} })!.harm === undefined, 'a pack converted before the block existed carries none, and that is not an error');
}

// --- the record and the join -------------------------------------------------------------------------

const client = ['object/mobile/vehicle/flow_skiff.iff', 'object/mobile/vehicle/high_hopper.iff', 'object/mobile/vehicle/ash_walker.iff'];
const immunity = lavaImmunityOf(client);
ok(immunity.source === 'pack' && immunity.keys.size === 3, 'three names read as three keys, from a pack');
ok(isLavaImmune('object/mobile/vehicle/shared_flow_skiff.iff', immunity), "a hull the client's table names takes none, spelled the pack's way");
ok(isLavaImmune('object/ship/shared_high_hopper.iff', immunity), 'and from any folder, since the file name is the whole key');
ok(!isLavaImmune('object/mobile/vehicle/shared_open_speeder.iff', immunity), 'a hull it does not name is not immune');
ok(!isLavaImmune(null, immunity) && !isLavaImmune(undefined, immunity) && !isLavaImmune('', immunity), 'a vehicle with no template of its own -- every creature -- is never immune');

// The one thing the basename key gives up, pinned here so it is a known choice and not a surprise:
// two templates in different folders that share a file name join alike. The client's own list names
// vehicles only, so this can bite only if a hull elsewhere is named exactly after one of them.
ok(isLavaImmune('object/building/shared_flow_skiff.iff', immunity), 'the key is the file name alone, so a same-named template in another folder joins too');

ok(!isLavaImmune('object/mobile/vehicle/shared_flow_skiff.iff', NO_LAVA_IMMUNITY), 'with no list at all nobody is immune, which is what a pack converted before this leaves');
ok(lavaImmunityOf(null).source === 'none' && lavaImmunityOf(undefined).keys.size === 0, 'no list makes the "nothing has said" record');
ok(Object.isFrozen(NO_LAVA_IMMUNITY) && Object.isFrozen(NO_LAVA_IMMUNITY.templates), 'and that record is frozen, since one object answers for every world with no pack to say');

// The join report: which of the garage's own templates the list names, and which of its names
// nothing in the garage carries. This is how the misses are seen rather than guessed at.
const garage = ['object/mobile/vehicle/shared_flow_skiff.iff', 'object/mobile/vehicle/shared_open_speeder.iff', 'object/ship/shared_high_hopper.iff', 'object/mobile/vehicle/shared_flow_skiff.iff'];
const report = joinImmunity(garage, immunity);
same(report.joined, ['flow_skiff', 'high_hopper'], 'two of the three are carried by something in the garage, each counted once');
same(report.missing, ['ash_walker'], 'the third is named by the client and converted by nothing');
same(joinImmunity([], immunity).missing, ['flow_skiff', 'high_hopper', 'ash_walker'], 'an empty garage misses all of them');
same(joinImmunity(garage, NO_LAVA_IMMUNITY), { joined: [], missing: [] }, 'with no list there is nothing to join and nothing missing');
same(joinImmunity([null, undefined, '', 'object/mobile/vehicle/shared_flow_skiff.iff'], immunity).joined, ['flow_skiff'], 'a garage entry with no template of its own is skipped rather than counted');

// --- the registry ---------------------------------------------------------------------------------

// What a hull's spawn asks. It is set once per pack, before anything can be spawned on that planet.
ok(lavaImmunity().source === 'none' && !lavaImmuneTemplate('object/mobile/vehicle/shared_flow_skiff.iff'), 'before any pack has said, nobody is immune');
setLavaImmunity(client);
ok(lavaImmuneTemplate('object/mobile/vehicle/shared_flow_skiff.iff'), 'once the pack has said, its hulls are');
ok(!lavaImmuneTemplate('object/mobile/vehicle/shared_open_speeder.iff'), 'and the ones it does not name are not');
ok(lavaImmunity().templates.length === 3, 'the names the pack spelled are kept for the console');
setLavaImmunity(['object/mobile/vehicle/open_speeder.iff']);
ok(lavaImmuneTemplate('object/mobile/vehicle/shared_open_speeder.iff') && !lavaImmuneTemplate('object/mobile/vehicle/shared_flow_skiff.iff'), 'the next planet replaces the list outright rather than adding to it');
setLavaImmunity(null);
ok(lavaImmunity().source === 'none' && !lavaImmuneTemplate('object/mobile/vehicle/shared_open_speeder.iff'), 'a world with no pack to say (a space zone, a world left) leaves nobody immune');
setLavaImmunity([]);
ok(lavaImmunity().source === 'pack' && lavaImmunity().keys.size === 0, 'a pack that names nobody is still a pack having said so');

// Asking twice answers the same twice, and asking costs one lookup, not a walk.
setLavaImmunity(client);
for (let i = 0; i < 100; i++) assert.equal(lavaImmuneTemplate('object/ship/shared_high_hopper.iff'), true, 'the answer is steady');
ok(true, 'a hundred asks answer the same: the record is read, never rebuilt');

// --- the report ------------------------------------------------------------------------------------

// The line the owner reads. A count of the client's own rows is no test of anything -- it is the same
// number on a working join and a broken one -- so what is printed is how many of them this build
// actually carries, and a join that finds none of them is a warning rather than a quiet line.
{
  setLavaImmunity(null);
  const quiet = heard(() => setImmunityCatalogue(garage));
  ok(quiet.info.length === 0 && quiet.warn.length === 0, 'a world with no pack to say prints nothing: that is every planet as the game stands');

  const good = heard(() => setLavaImmunity(client));
  ok(good.warn.length === 0 && good.info.length === 1, 'a list that joins is one line and no warning');
  ok(/names 3 /.test(good.info[0]) && /carries 2 of them/.test(good.info[0]) && /no model for 1/.test(good.info[0]), `it says both sides, not just the pack's own count (${good.info[0].split('\n')[0]})`);
  ok(good.info[0].includes('carried: flow_skiff, high_hopper') && good.info[0].includes('not in this build: ash_walker'), 'and names which joined and which did not');
  ok(/resistance/.test(good.info[0]), 'and says outright that the resistance column is not modelled, since a row here is all or nothing');

  // The failure this whole report exists for: a list whose names nothing in the build carries. The
  // old line could not tell this from the one above, because it counted the pack's rows only.
  const bad = heard(() => setLavaImmunity(['object/mobile/vehicle/nothing_like_this.iff', 'object/mobile/vehicle/nor_this.iff']));
  ok(bad.warn.length === 1 && bad.info.length === 0, 'a list that joins to nothing warns instead');
  ok(/carries 0 of them/.test(bad.warn[0]) && /do not meet/.test(bad.warn[0]), `and says why in words (${bad.warn[0].split('\n').pop()})`);

  const empty = heard(() => setLavaImmunity([]));
  ok(empty.info.length === 1 && /names nobody/.test(empty.info[0]), 'a converted pack whose list is empty says so, which is not the same as a pack that says nothing');

  const again = heard(() => setLavaImmunity([]));
  ok(again.info.length === 0 && again.warn.length === 0, 'and the same thing is never said twice, however many worlds are loaded');

  setLavaImmunity(null);
  const gone = heard(() => setImmunityCatalogue([]));
  ok(gone.info.length === 0 && gone.warn.length === 0, 'a build with no models to carry and no pack to say is silent too');
}

console.log(`\n${passed} checks passed`);
