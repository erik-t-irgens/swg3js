// The places of a world resolved (Map-maker II's eighth wave, `src/world/places.ts`): the smallest place of ours holding a
// point wins and the world row is under all; the no-build verdict is every place made no-build, and only under the world
// row's `cities: 'noBuild'` the game's own cities, Core3's no-build areas and the client's no-build radii too, each in its
// own words; the rows are carried into the game's frame about the world's centre ((0, 0) on a world with no pack); a place of
// ours merged into the places list reaches what reads it (the city line, the teleport's arithmetic, the map's rows); and the
// galaxy's loader merges the file and answers a packless world's centre as (0, 0).
//
// Run: node tools/swg/tests/placesIndex.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PlaceIndex, PlaceIndexKeeper, locationPoi, mergeLocations, zoneWords, zoneWordsOf, type GameNoBuild, type MapPlace } from '../../../src/world/places.ts';
import type { LocationRow } from '../../../src/world/editFiles/locationsFile.ts';
import { cityAt, type CityRow } from '../../../src/story/cities.ts';
import { placeFromPois } from '../../../src/world/loadingTune.ts';
import { PLANETS } from '../../../src/data/planets.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const read = (rel: string) => readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8');

const centre = { x: 300, z: -200 };
/** A raw point of the file in the game's frame about the centre (the world's own mirror). */
const game = (x: number, z: number) => ({ x: centre.x - x, z: z - centre.z });

const rows: LocationRow[] = [
  { id: 'world', kind: 'world', loading: ['the world'] },
  { id: 'region', kind: 'area', name: 'The Wastes', shape: { kind: 'rect', min: [-2000, -2000], max: [2000, 2000] } },
  { id: 'town', kind: 'city', name: 'Dune Town', shape: { kind: 'circle', c: [100, 100], r: 300 }, build: false },
  { id: 'yard', kind: 'zone', name: 'The Yard', shape: { kind: 'poly', pts: [[50, 50], [150, 50], [150, 150], [50, 150]] } },
];

{
  const idx = new PlaceIndex().build({ rows, centre });
  const a = game(100, 100);
  const b = game(300, 100);
  const c = game(1500, 1500);
  const d = game(5000, 5000);
  ok(idx.placeAt(a.x, a.z)?.id === 'yard', 'the smallest place holding a point wins: a yard in a town in a region');
  ok(idx.placeAt(b.x, b.z)?.id === 'town' && idx.placeAt(c.x, c.z)?.id === 'region', 'out of the yard the town, out of the town the region');
  ok(idx.placeAt(d.x, d.z) === null && idx.world?.id === 'world', 'in no place none, and the world row is under all');
  ok(idx.counts.ours === 1 && idx.noBuildAt(b.x, b.z, 0)?.why === 'ours' && idx.noBuildAt(c.x, c.z, 0) === null, 'a place made no-build is a zone and the rest are not');
  const edge = game(100 + 300 + 4, 100);
  ok(idx.noBuildAt(edge.x, edge.z, 3) === null && idx.noBuildAt(edge.x, edge.z, 5)?.name === 'Dune Town', "a circle reaching the zone's edge touches it, and one short of it does not");
  ok(idx.gameNoBuild === false && idx.counts.city === 0 && idx.counts.region === 0 && idx.counts.radius === 0, "the game's own no-build data stays out with the world row's switch off");
  // The frame: the town's circle as the index keeps it is the raw middle carried into the game's frame (x mirrored about the
  // centre's x, z less the centre's z), read off the index's own list and not worked out here.
  const town = [...Array(idx.held.count).keys()].find((i) => idx.held.tag[i] === 2) ?? -1;
  ok(town >= 0 && idx.held.p[town * 4] === 300 - 100 && idx.held.p[town * 4 + 1] === 100 - -200 && idx.held.p[town * 4 + 2] === 300, `the index keeps a raw point in the game's frame about the centre, x mirrored (the town's middle at ${idx.held.p[town * 4]}, ${idx.held.p[town * 4 + 1]})`);
}

{
  // The world row's switch: the game's cities, no-build areas and radii keep players off too, each in its words.
  const pois = [
    { name: 'Mos Town', x: 1000, z: 0, r: 400, kind: 'city' },
    { name: 'Tiny', x: 0, z: 1000, r: 20, kind: 'city' },
    { name: 'A Port', x: -1000, z: 0, r: 0, kind: 'starport' },
  ];
  const noBuild: GameNoBuild[] = [
    { from: 'region', name: 'mos_town_nobuild', shape: 'circle', x: 3000, z: 0, r: 100 },
    { from: 'region', name: 'yard_rect', shape: 'rect', x: 4000, z: 0, x2: 4100, z2: 50 },
    { from: 'region', name: 'ring_one', shape: 'ring', x: 5000, z: 0, inner: 50, r: 100 },
    { from: 'radius', x: 6000, z: 0, r: 32, t: 'object/building/tatooine/shared_bank_tatooine.iff' },
  ];
  const off = new PlaceIndex().build({ rows: rows.filter((r) => r.id !== 'world'), centre, pois, noBuild });
  const on = new PlaceIndex().build({ rows: [{ id: 'world', kind: 'world', cities: 'noBuild' }, ...rows.filter((r) => r.id !== 'world')], centre, pois, noBuild });
  ok(off.counts.city + off.counts.region + off.counts.radius === 0, "with no world row the pack's cities, regions and radii are open (the game's own cities stay buildable)");
  ok(on.gameNoBuild && on.counts.city === 1 && on.counts.region === 3 && on.counts.radius === 1, `under cities noBuild: one city past its least reach, three areas, one radius (${JSON.stringify(on.counts)})`);
  const at = (x: number, z: number, r = 0) => {
    const g = game(x, z);
    return on.noBuildAt(g.x, g.z, r);
  };
  ok(at(1000, 0)?.why === 'city' && at(0, 1000) === null && at(-1000, 0) === null, "a city by its reach (a reach under the least, and a port, are not cities)");
  ok(at(3050, 0)?.why === 'region' && at(4050, 25)?.why === 'region' && at(5075, 0)?.why === 'region' && at(5000, 0) === null, "a no-build area's circle, rectangle and ring (its hole open)");
  ok(at(6010, 0)?.why === 'radius' && at(6040, 0) === null && at(6040, 0, 10)?.why === 'radius', "a placed thing's radius, touched by a circle reaching it");
  const city = at(1000, 0)!;
  ok(zoneWordsOf(city, 'house') === 'nobody may build in Mos Town' && zoneWordsOf(city, 'prop') === 'nobody may put things down in Mos Town' && zoneWordsOf(city, 'editor') === 'inside Mos Town, where players may not build', "a city's words, a house's, a thing's and the editor's");
  ok(/the game keeps Mos Town Nobuild clear/.test(zoneWords(at(3050, 0)!, 'house')) && /this close to/.test(zoneWords(at(6010, 0)!, 'prop')) && /beside .*whose ground/.test(zoneWords(at(6010, 0)!, 'editor')), "an area's and a radius's words");
  ok(zoneWordsOf(city, 'house') === zoneWordsOf(city, 'house') && city.said !== undefined, 'the words made once and kept (a ghost asking every frame makes nothing)');
}

{
  // A place of ours merged into the places list reaches what reads it.
  const pack: MapPlace[] = [{ name: 'Old Town', x: 500, z: 500, r: 300, kind: 'city' }];
  ok(mergeLocations(pack, []) === pack && mergeLocations(pack, [rows[0], rows[3]]) === pack, 'with no place drawn on the map the very list comes back (nothing new to read)');
  const merged = mergeLocations(pack, rows);
  ok(pack.length === 1 && merged !== pack, "the pack's own list is never written (the merged one is a list of its own)");
  ok(merged.length === 3 && merged[0] === pack[0] && merged.map((p) => p.name).join() === 'Old Town,The Wastes,Dune Town', "the pack's rows first, then each place drawn on the map in the file's order (a zone is not)");
  const town = merged[2];
  ok(town.ours === true && town.id === 'town' && town.kind === 'city' && town.x === 100 && town.z === 100 && town.r === 300 && town.say === true && town.build === false && town.shape?.kind === 'circle', 'a place as a row: its middle, reach, kind, shape, say and build');
  ok(locationPoi(rows[0]) === null && locationPoi(rows[3]) === null, 'the world row and a zone are never rows of the list');
  // The city line reads it by its own shape and say.
  ok(cityAt(merged as CityRow[], 100, 380)?.name === 'Dune Town' && cityAt(merged as CityRow[], 500, 500)?.name === 'Old Town', "the city line takes a place of ours by its shape, beside the pack's own city");
  ok(cityAt(merged as CityRow[], 1500, 1500) === null, 'and an area that does not say its name is no city to walk into');
  // The teleport's arithmetic, the very function it calls.
  const g = placeFromPois(centre, town);
  ok(g.x === 200 && g.z === 300, "the teleport stands a place of ours where the index stands it");
}

{
  // The galaxy's loader merges the file and answers a packless world's centre as (0, 0); the worlds with no pack say so.
  const galaxy = read('src/ui/galaxyMap.ts');
  ok(/p = Promise\.all\(\[pack, locs\]\)\.then\(\(\[f, rows\]\) => this\.mergedFile\(planetId, f, rows\)\);/.test(galaxy), 'loadPoisRaw reads the pack and the locations file and merges them');
  ok(/const packless = PLANETS\.some\(\(p\) => p\.id === planetId && p\.pack === false\);\s*return \{ center: f\.center \?\? \(packless \? \{ x: 0, z: 0 \} : null\), pois: mergeLocations\(f\.pois, rows\)/.test(galaxy), "a world with no pack is measured about (0, 0), the places merged after the pack's");
  ok(/if \(!def \|\| def\.space \|\| def\.instances\) return \[\];/.test(galaxy), "a space zone's and the copies' files are read by nobody this pass");
  const packless = PLANETS.filter((p) => p.pack === false).map((p) => p.id);
  ok(packless.includes('monument') && packless.includes('helens'), `the real-elevation worlds declare no pack (${packless.join(', ')})`);
  const main = read('src/main.ts');
  ok(/private placesNow\(\): PlaceIndex \{\s*return this\.placeKeeper\.now\(this\.placesFile, this\.world\.placeFrame, worldStateStamp\(\), !!this\.world\.planet\?\.space, standsIn\);\s*\}/.test(main), "the game's index is the keeper's, asked with the merged file, placeFrame, the world states' stamp, space and the states' own test");
  ok(/landLocations\(planetId: string, put: readonly LocationRow\[\], deleted: readonly string\[\]\): Promise<PoisFile> \{\s*const was = await this\.loadPoisRaw\(planetId\);\s*const rows = landedLocations\(was\.locations, put, deleted\);/.test(galaxy), "a write is landed by the places' own rule (landedLocations)");
  ok(/if \(!\(type\.includes\('json'\) \|\| type\.includes\('text\/plain'\)\)\) return \[\];/.test(galaxy), "and a locations file answered with the page (a missing public file on the dev server) is no file");
}

{
  // The keeper (`PlaceIndexKeeper`, what `App.placesNow` asks every frame a ghost is in hand): built again only when the file,
  // the frame's centre, the world states' stamp or space moves; a world with no frame yet remembered as having none, so it is
  // not built again at every ask; empty with no file, no frame or in space; the rows that do not stand in the state left out.
  const file = { locations: rows, pois: [{ name: 'Mos Town', x: 1000, z: 0, r: 400, kind: 'city' }], noBuild: [] as GameNoBuild[] };
  const k = new PlaceIndexKeeper();
  const yes = () => true;
  k.now(file, null, 1, false, yes);
  k.now(file, null, 1, false, yes);
  k.now(file, null, 1, false, yes);
  ok(k.builds === 1 && k.index.held.count === 0, 'with no frame yet, built once (empty) and not again at every ask');
  const at = { x: 300, z: -200 };
  const a = k.now(file, at, 1, false, yes);
  ok(k.builds === 2 && a.held.count === 3, 'a frame arriving builds it (three places with a shape)');
  for (let i = 0; i < 5; i++) k.now(file, at, 1, false, yes);
  ok(k.builds === 2, 'and asked again with nothing moved, it is the same index, unbuilt');
  k.now(file, { x: 300, z: -200 }, 1, false, yes);
  ok(k.builds === 2, 'a centre at the same place is the same frame');
  k.now(file, { x: 301, z: -200 }, 1, false, yes);
  ok(k.builds === 3, 'a centre moved builds it again');
  // A world state taken: the rows tagged for another state leave.
  const tagged = { ...file, locations: [...rows, { id: 'ruin', kind: 'place' as const, name: 'The Ruin', shape: { kind: 'circle' as const, c: [0, 0] as [number, number], r: 30 }, state: 'restuss=ruins' }] };
  let state = 'living';
  const stands = (s?: string | null) => !s || s === `restuss=${state}`;
  k.now(tagged, at, 7, false, stands);
  ok(k.index.held.count === 3, 'a row tagged for a state not in force is left out');
  state = 'ruins';
  k.now(tagged, at, 7, false, stands);
  ok(k.index.held.count === 3, 'and a state taken with the stamp unmoved builds nothing');
  k.now(tagged, at, 8, false, stands);
  ok(k.index.held.count === 4, 'the stamp moved, it is built again and the row in the state now in force stands');
  k.now(tagged, at, 8, true, stands);
  ok(k.index.held.count === 0 && k.index.world === null, 'in space it is empty');
  k.now(null, at, 8, false, stands);
  ok(k.index.held.count === 0, 'and with no file');
}

console.log(`placesIndex: ${checks} checks passed`);
