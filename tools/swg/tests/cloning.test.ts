// Dying at a cloning facility: the rule by itself (`src/world/cloning.ts`), with no world, no
// physics and no page. Which object templates are facilities and which are the scenery standing
// beside them, the nearest-first list with the distance from where you fell, what a facility is
// called, which room to stand up in, and the fallback on a world that has none.
//
// Everything in the first half is made up: the templates, places and cells below are invented
// shapes, not paths out of anybody's archives. That is the point of the shapes rather than the
// names -- the rule is about the shape of a name -- and the last section is what checks it against
// the real ones: it reads the converted packs when they are on this machine and says what it found.
// With no `assets-private/` it says so and passes, because the rule is the thing under test and the
// packs are the owner's.
//
// Two of the checks are about the code rather than about a value, and they are here deliberately:
// the game's own cell pick must *call* the rule this file runs rather than keep a copy of it, and
// the card's distances must be the interface's own spelling rather than a second one. A copy that
// comes back would pass every value check in this file and be wrong in play, which is exactly how
// this landed the first time.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLONING_TUNE,
  facilitiesNear,
  isCloningFacility,
  namedCellIndex,
  placeNameAt,
  SPAWN_CELL_NAME,
  type CellLike,
  type NamedPlace,
  type PlacedLike,
} from '../../../src/world/cloning.ts';
// The words a distance reads in are the interface's, and one spelling serves the group roster and
// this card alike; `hudMath` is the pure half of the interface, so a node test can hold it.
import { distanceWords } from '../../../src/ui/hudMath.ts';

/** The threshold the interface passes in (`ROSTER_TUNE.kmFrom`); moved live at the console. */
const KM_FROM = 1000;

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const at = (template: string, x: number, z: number, extra: Partial<PlacedLike> = {}): PlacedLike => ({ template, x, y: 0, z, ...extra });
// The room a facility stands the dead up in is the one pick asked for one name; there is no second
// function for it, in the game or here, because a second one is how the two came apart before.
const spawnCell = (cells: readonly CellLike[] | undefined): number => namedCellIndex(cells, SPAWN_CELL_NAME);

// Invented templates in the shapes the rule has to tell apart: a building whose name carries the
// whole word, the scenery that stands beside one and carries it too, a post under the buildings
// whose name carries the other form of the word in a compound, and a longer word the letters happen
// to sit inside. None of these is a path out of anything; the pack sweep at the foot is what holds
// the rule to the real names.
const FACILITY = 'object/building/somewhere/shared_cloning_facility_somewhere.iff';
const FACILITY_B = 'object/building/elsewhere/shared_somewhere_cloning_hall.iff';
const FACILITY_C = 'object/building/player/town/shared_cloning_somewhere.iff';
const TUBE = 'object/static/structure/general/shared_cloning_vessel.iff';
const SIGN = 'object/static/worldbuilding/sign/shared_sign_cloning_here.iff';
const TERMINAL = 'object/static/worldbuilding/terminal/shared_floor_cloning_02.iff';
const TENT = 'object/static/structure/military/shared_somewhere_clone_tent_large.iff';
const MARKER = 'object/building/somewhere/structures/shared_some_mining_clone_marker.iff';
const INSIDE_A_WORD = 'object/building/somewhere/shared_recloning_annexe.iff';
const HOUSE = 'object/building/somewhere/shared_house_small.iff';

// --- which templates are facilities ---------------------------------------------------------------
{
  ok(isCloningFacility(FACILITY) && isCloningFacility(FACILITY_B) && isCloningFacility(FACILITY_C), 'the whole word under the world�s buildings is what makes a facility, wherever in the name it falls');
  ok(!isCloningFacility(TUBE) && !isCloningFacility(SIGN) && !isCloningFacility(TERMINAL) && !isCloningFacility(TENT), 'the vessels, the signs, the floor terminals and the tents are scenery, not facilities: the game files them under its furniture rather than its buildings');
  ok(!isCloningFacility(MARKER), 'a marker post under the buildings carries the other form of the word in a compound and is not a facility');
  ok(!isCloningFacility(INSIDE_A_WORD), 'and the letters inside a longer word are not the word: the match is between separators, not anywhere in the path');
  ok(!isCloningFacility(HOUSE), 'an ordinary building is not one either');
  ok(!isCloningFacility('') && !isCloningFacility('shared_cloning_facility_somewhere.iff'), 'a template with no path at all is refused rather than thrown at');
  ok(!isCloningFacility('object/static/cloning_facility_prop.iff'), 'the word alone is not enough: it must be one of the world�s buildings');
  ok(isCloningFacility(FACILITY.toUpperCase().replace('OBJECT/BUILDING/', 'object/building/')), 'the word is read as a word and not as bytes, whatever case the snapshot spells it in');
}

// --- nearest first, with the distance from where you fell -----------------------------------------
{
  const objects = [
    at(FACILITY, 300, 0),
    at(FACILITY, 0, 100),
    at(TUBE, 1, 1),
    at(FACILITY_B, -50, 0),
    at(HOUSE, 2, 2),
  ];
  const rows = facilitiesNear(objects, { x: 0, z: 0 });
  ok(rows.length === 3, 'only the facilities are offered, whatever else stands about');
  ok(rows[0].d < rows[1].d && rows[1].d < rows[2].d, 'nearest first');
  ok(Math.round(rows[0].d) === 50 && Math.round(rows[1].d) === 100 && Math.round(rows[2].d) === 300, 'the distance is from where you fell, on the ground plane');
  const high = facilitiesNear([at(FACILITY, 0, 40, { y: 300 })], { x: 0, z: 0 });
  ok(Math.round(high[0].d) === 40, 'a facility three hundred metres above you is forty metres away, as every other "near me" in the game measures');
  ok(facilitiesNear(objects, { x: 0, z: 0 }, [], 2).length === 2, 'the card asks for a few and gets a few');
  ok(facilitiesNear(objects, { x: 0, z: 0 }, [], 0).length === 3, 'and nought asks for the lot');
  ok(facilitiesNear(objects, { x: 0, z: 0 }).length <= CLONING_TUNE.shown, 'the default is the card�s own length');
}

// --- a world with none falls back ------------------------------------------------------------------
{
  ok(facilitiesNear([at(TUBE, 0, 0), at(HOUSE, 5, 5), at(MARKER, 9, 9)], { x: 0, z: 0 }).length === 0, 'a world whose only mention of the word is scenery offers nothing');
  ok(facilitiesNear([], { x: 0, z: 0 }).length === 0, 'and a world with nothing placed at all offers nothing rather than throwing');
  ok(facilitiesNear([at(FACILITY, 10, 0, { contained: true })], { x: 0, z: 0 }).length === 0, 'a facility placed inside another building is not a place to come back to');
}

// --- what a facility is called ----------------------------------------------------------------------
{
  const places: NamedPlace[] = [
    { name: 'Town', x: 0, z: 0, r: 400 },
    { name: 'Hamlet', x: 900, z: 0 },
  ];
  const continent: NamedPlace[] = [{ name: 'The whole continent', x: 0, z: 0, r: 9000 }];
  ok(placeNameAt(100, 0, places) === 'Town', 'a facility inside a place with a reach of its own takes that name');
  ok(placeNameAt(900, 120, places) === 'Hamlet', 'a place with no reach of its own claims what is within the plain range');
  ok(placeNameAt(900, CLONING_TUNE.placeRange + 120, places) === null, 'and nothing beyond it');
  ok(placeNameAt(0, CLONING_TUNE.placeMaxReach - 10, continent) === 'The whole continent' && placeNameAt(0, CLONING_TUNE.placeMaxReach + 10, continent) === null, 'a row that covers a quarter of the world is believed only so far: being on the continent is not a name');
  ok(placeNameAt(0, 20, [{ name: 'Far', x: 0, z: 300, r: 400 }, { name: 'Near', x: 0, z: 0, r: 400 }]) === 'Near', 'the nearest of two that both reach wins, whichever order the list is in');
  ok(placeNameAt(0, 0, []) === null, 'a pack with no list of places names nothing');
  ok(placeNameAt(0, 0, [{ name: '', x: 0, z: 0 }] as NamedPlace[]) === null, 'a row with no name is stepped over');
  const rows = facilitiesNear([at(FACILITY, 50, 0), at(FACILITY, 5000, 5000)], { x: 0, z: 0 }, places);
  ok(rows[0].name === 'Town', 'the row wears the name of the place it stands in');
  ok(rows[1].name === CLONING_TUNE.unnamed, 'and one out in the wild wears the plain word rather than nothing at all');
}

// --- which room to stand up in -------------------------------------------------------------------
{
  const purposeBuilt = [
    { index: 0, name: 'r0' },
    { index: 1, name: 'foyer' },
    { index: 4, name: 'spawn' },
    { index: 5, name: 'ramptop' },
  ];
  ok(spawnCell(purposeBuilt) === 4, 'the room a facility�s own layout names is the room to stand up in');
  ok(spawnCell([{ index: 0, name: 'r0' }, { index: 1, name: 'foyer' }]) === 0, 'a building with no such room answers nought, which is the caller�s cue to use the way in');
  ok(spawnCell(undefined) === 0 && spawnCell([]) === 0, 'so does a model with no rooms at all');
  ok(spawnCell([{ index: 0, name: 'spawn' }]) === 0, 'the shell is never a room to stand in, whatever it is called');
  ok(spawnCell([{ index: 3, name: ' Spawn ' }]) === 3, 'the name is read as a name, not as bytes');
  ok(SPAWN_CELL_NAME === 'spawn', 'the word itself is the archives�: it is what the purpose-built layouts call that room');
  // It is a general pick, which is why the streamer can hand it any name; the dead going in *this*
  // room is our reading of a room name the client uses for all sorts of things.
  ok(namedCellIndex(purposeBuilt, 'foyer') === 1 && namedCellIndex(purposeBuilt, 'RAMPTOP') === 5, 'any room can be asked for by name, which is the whole of the pick');
  ok(namedCellIndex(purposeBuilt, 'cellar') === 0 && namedCellIndex(purposeBuilt, '  ') === 0, 'a name no room carries, and a name that is no name, both answer nought');
  ok(namedCellIndex([{ index: 2, name: null }, { index: 3, name: 'spawn' }] as unknown as { index: number; name: string }[], 'spawn') === 3, 'a manifest row without a name of its own is stepped over rather than thrown at: a respawn must not die inside a TypeError');
}

// --- the game's own pick is this pick, and not a copy of it -----------------------------------------
// The rule above is worth nothing if the streamer keeps its own search beside it: the two would
// drift, and every check in this file would still pass. So the file is read.
{
  const here = dirname(fileURLToPath(import.meta.url));
  const streamer = readFileSync(join(here, '..', '..', '..', 'src', 'world', 'layoutStream.ts'), 'utf8');
  ok(/import \{[^}]*namedCellIndex[^}]*\} from '\.\/cloning\.ts'/.test(streamer), 'the streamer imports the pick rather than writing one');
  ok(streamer.includes('namedCellIndex(cells, name)'), 'and its named entry calls it');
  ok(!/\.name\.trim\(\)\.toLowerCase\(\)/.test(streamer), 'with no second cell-name search anywhere in the file');
}

// --- the distance in words ---------------------------------------------------------------------------
// One spelling serves the group roster down the side of the screen and this card, and the threshold
// is handed in rather than frozen here, so moving it at the console moves both together.
{
  ok(distanceWords(0, KM_FROM) === '0 m' && distanceWords(12.4, KM_FROM) === '12 m' && distanceWords(999, KM_FROM) === '999 m', 'metres up to the threshold');
  ok(distanceWords(1000, KM_FROM) === '1.0 km' && distanceWords(4321, KM_FROM) === '4.3 km', 'then kilometres to one place');
  ok(distanceWords(1400, 2000) === '1400 m' && distanceWords(1400, 1000) === '1.4 km', 'and the threshold is the caller�s: the same distance reads either way, which is why there must not be two of these');
  ok(distanceWords(Number.NaN, KM_FROM) === '' && distanceWords(-1, KM_FROM) === '', 'nothing at all for a distance that is not one, since both `0 m` and `NaN m` would be a statement and neither is true');
}

// --- and the card reads it from the interface, not from a copy of its own ----------------------------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, '..', '..', '..');
  const rule = readFileSync(join(root, 'src', 'world', 'cloning.ts'), 'utf8');
  const main = readFileSync(join(root, 'src', 'main.ts'), 'utf8');
  ok(!rule.includes('distanceWords'), 'the rule file keeps no words of its own');
  ok(/import \{[^}]*distanceWords[^}]*\} from '\.\/ui\/hud'/.test(main), 'and the card takes the interface�s, threshold and all');
}

// --- the converted packs, when they are on this machine ----------------------------------------------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, '..', '..', '..');
  const assets = join(root, 'assets-private');
  if (!existsSync(assets)) {
    console.log('note the converted packs are not on this machine, so the counts below were not checked');
  } else {
    let total = 0;
    let withSpawn = 0;
    let withRooms = 0;
    let spawnRoomsElsewhere = 0;
    const emptyWorlds: string[] = [];
    for (const pack of readdirSync(assets)) {
      const layoutFile = join(assets, pack, 'layout.json');
      const manifestFile = join(assets, pack, 'manifest.json');
      if (!existsSync(layoutFile)) continue;
      const layout = JSON.parse(readFileSync(layoutFile, 'utf8')) as { objects: PlacedLike[] };
      const rows = facilitiesNear(layout.objects ?? [], { x: 0, z: 0 }, [], 0);
      const cellsOf = new Map<string, { index: number; name: string }[]>();
      if (existsSync(manifestFile)) {
        const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as { categories?: Record<string, { id: string; cells?: { index: number; name: string }[] }[]> };
        for (const list of Object.values(manifest.categories ?? {})) for (const def of list) if (def.cells) cellsOf.set(def.id, def.cells);
      }
      for (const o of layout.objects ?? []) {
        const cells = cellsOf.get((o as PlacedLike & { model?: string }).model ?? '');
        const facility = isCloningFacility(o.template) && !o.contained;
        // The word inside a building is not a word about the dead: it is an ordinary room name, and
        // counting where else it stands is what keeps this file honest about whose meaning it is.
        if (!facility && spawnCell(cells) > 0) spawnRoomsElsewhere++;
        if (!facility) continue;
        if (cells && cells.some((c) => c.index > 0)) withRooms++;
        if (spawnCell(cells) > 0) withSpawn++;
      }
      if (!rows.length) {
        emptyWorlds.push(pack);
        continue;
      }
      total += rows.length;
      console.log(`note ${pack}: ${rows.length} facilities, the nearest to the snapshot�s middle ${distanceWords(rows[0].d, KM_FROM)} out`);
    }
    console.log(`note ${total} facilities over the converted packs, ${withRooms} with rooms, ${withSpawn} with the room named for standing up in`);
    console.log(`note worlds that offer none: ${emptyWorlds.join(', ') || 'none'}`);
    console.log(`note that room name stands in ${spawnRoomsElsewhere} placed things that are not facilities at all, which is why its meaning here is ours and not the client�s`);
    ok(total === 0 || withRooms === total, 'every facility found in a converted pack is a building with rooms, so there is somewhere to put the player');
    ok(total === 0 || withSpawn > 0, 'and some of them carry the room named for standing up in');
    ok(total === 0 || spawnRoomsElsewhere > 0, 'and the room name is one the client uses elsewhere too, measured rather than argued');
    // The fallback is not a branch nobody reaches: there really are converted worlds with none.
    ok(total === 0 || emptyWorlds.length > 0, 'some converted packs offer none at all, which is the branch that keeps the plain button');
  }
}

console.log(`\n${checks} checks passed`);
