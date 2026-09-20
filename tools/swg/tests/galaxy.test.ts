// The galaxy map's data: which worlds share a system, where each system stands, where a jump into a
// system comes out, and the shuttle routes turned into lines. Synthetic data only: every pack, route
// table and catalogue below is made up, no file of the client's is read, and the numbers are chosen to
// be easy to check by eye. Each case says what real shape it stands for.
import assert from 'node:assert/strict';
import { PLANETS } from '../../../src/data/planets.ts';
import {
  GALAXY_LEFT_OUT, GALAXY_SYSTEMS, GALAXY_TUNE, destinationFor, drawnSystems, gridSquare, idsOf, planetOfRouteId, planetTextureOf, systemOf, systemPlace, systemRoutes, worldsOf, zoneFor,
  type GalaxyFile, type GalaxySystemDef,
} from '../../../src/data/galaxy.ts';
import { HyperspaceCatalogue, destinationsOf, type SpacePack } from '../../../src/space/spaceData.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// 1. Every world the game has belongs to exactly one system, and nothing is claimed twice. This is
// the check that catches a new planet or space zone added without a place in the galaxy.
const claims = new Map<string, string[]>();
for (const sys of GALAXY_SYSTEMS) for (const id of idsOf(sys)) claims.set(id, [...(claims.get(id) ?? []), sys.id]);
const homeless = PLANETS.filter((p) => !claims.has(p.id) && !GALAXY_LEFT_OUT.includes(p.id)).map((p) => p.id);
ok(homeless.length === 0, `every planet and space zone belongs to a system (${homeless.join(', ') || 'none homeless'})`);
const twice = [...claims].filter(([, list]) => list.length > 1).map(([id]) => id);
ok(twice.length === 0, `no world is claimed by two systems (${twice.join(', ') || 'none'})`);
ok(GALAXY_SYSTEMS.length === new Set(GALAXY_SYSTEMS.map((s) => s.id)).size, 'the systems have distinct ids');
ok(systemOf('gallery') === null && GALAXY_LEFT_OUT.includes('gallery'), 'the development world is left out on purpose');
ok(!!systemOf('talus') && systemOf('talus') === systemOf('corellia'), 'two worlds of one system share it');
ok(drawnSystems().every((s) => worldsOf(s).length > 0), 'a system whose worlds this build does not have is not drawn');
// The rule, not today's count: a system is drawn exactly when this build has one of its worlds. A
// count ("more systems than drawn ones") would go red the day the last unbuilt world is added, which
// is a change in another file entirely.
const unbuilt: GalaxySystemDef = { ...fakeSystem('unbuilt', 'A-1'), worlds: [{ planet: 'a_world_this_build_does_not_have' }] };
ok(worldsOf(unbuilt).length === 0, 'a system named for a world that does not exist yet has nothing to draw');
ok(GALAXY_SYSTEMS.every((s) => drawnSystems().includes(s) === (worldsOf(s).length > 0)), 'a system is drawn exactly when this build has one of its worlds');

// 2. The grid squares. A square is a letter and a number; the map is laid out in squares from the
// middle of the grid, so one square east is one square's width along X and one south along Z.
ok(gridSquare('M-11')?.col === 12 && gridSquare('M-11')?.row === 11, 'a grid square reads as a column letter and a row number');
ok(gridSquare('a 1')?.col === 0 && gridSquare('a 1')?.row === 1, 'a square is read whatever its case and spacing');
ok(gridSquare('AA-3') === null && gridSquare('M-') === null, 'a square that is neither a letter nor a number is refused');

// A made-up system, for the layout and the drawing rule. Declared as a function so the rule above
// can use it before this line.
function fakeSystem(id: string, grid: string | null, at?: { col: number; row: number }): GalaxySystemDef {
  return { id, name: id, grid, at, confidence: 'ours', zone: null, worlds: [] };
}
const west = systemPlace(fakeSystem('west', 'A-13'));
const east = systemPlace(fakeSystem('east', 'B-13'));
ok(Math.abs(east.x - west.x - GALAXY_TUNE.square) < GALAXY_TUNE.square * GALAXY_TUNE.jitter * 2.01, 'the next column east is one square further along X');
const south = systemPlace(fakeSystem('south', 'A-14'));
ok(south.z > west.z, 'the next row down the grid is further along Z');
const twiceSame = systemPlace(fakeSystem('west', 'A-13'));
ok(twiceSame.x === west.x && twiceSame.y === west.y && twiceSame.z === west.z, 'a system stands in the same place every time it is asked');
const roommate = systemPlace(fakeSystem('other', 'A-13'));
ok(Math.hypot(roommate.x - west.x, roommate.y - west.y, roommate.z - west.z) > 0, 'two systems in one square do not sit on top of each other');
const offGrid = systemPlace(fakeSystem('outside', null, { col: -2, row: 12 }));
ok(offGrid.x < west.x, 'a system with no square stands where its own column and row put it, west of the grid');

// 3. The shuttle routes. They stand for the travel table the `maps` command writes into the owner's
// pack: named by the planet packs, both ways, with a fare in each direction and a world of a system
// that also holds another (Corellia and Talus) whose route between them draws nothing.
const file: GalaxyFile = {
  version: 1,
  planets: [],
  routes: [
    { from: 'corellia', to: 'tatooine', price: 1000 },
    { from: 'tatooine', to: 'corellia', price: 700 },
    { from: 'corellia', to: 'talus', price: 100 },
    { from: 'kashyyyk_main', to: 'naboo', price: 500 },
    { from: 'corellia', to: 'coruscant', price: 900 },
  ],
  local: { corellia: 50 },
};
const routes = systemRoutes(file);
ok(routes.length === 2, 'a route inside one system and a route to a world we do not have both draw nothing');
const tatoo = routes.find((r) => r.from === 'corellian' || r.to === 'corellian');
ok(!!tatoo && tatoo.price === 700, 'a pair named both ways is one line, at the lower fare');
ok(routes.some((r) => (r.from === 'kashyyyk' && r.to === 'naboo') || (r.from === 'naboo' && r.to === 'kashyyyk')), 'a route named by a zone pack is read as that zone\'s world');
ok(planetOfRouteId('kashyyyk_main')?.id === 'kashyyyk' && planetOfRouteId('coruscant') === null, 'a pack name resolves to its planet, and an unknown name to nothing');
ok(systemRoutes(null).length === 0, 'with no galaxy.json converted, no routes are drawn');

// 4. Where a jump into a system comes out. These packs stand for a planet's orbit with a launch point
// and a station named after the neighbouring world (Corellia's, which holds Talus's station), and for a
// system that is nobody's orbit and arrives at a point of its own (Kessel, Deep Space, Ord Mantell).
//
// The orbit's points carry the shape the real packs have and the shape that catches the bugs: a
// hyperspace point named after the NEIGHBOURING world (the converted Corellian pack's fifth point
// carries Talus's name), a station whose world's name is two words, and a station whose name merely
// starts with another world's name. A zone lists its points before its stations, so a jump that took
// the first destination of any kind naming the world would land at the point, not the station.
const orbit: SpacePack = {
  version: 3,
  zone: 'space_corellia',
  planet: 'corellia',
  title: 'Corellian System',
  stations: [
    { name: 'station_one', title: 'Corellia Station', description: '', model: 'a', x: 100, y: 0, z: 0, radius: 200, approachClearance: null },
    { name: 'station_two', title: 'Talus Station', description: '', model: 'b', x: -100, y: 0, z: 0, radius: 200, approachClearance: null },
    { name: 'station_three', title: 'Yavin IV Station', description: '', model: 'c', x: 0, y: 0, z: 200, radius: 200, approachClearance: null },
    { name: 'station_four', title: 'Loknar Depot', description: '', model: 'd', x: 0, y: 0, z: -200, radius: 200, approachClearance: null },
  ],
  scenery: [],
  planets: [
    { appearance: 'appearance/planet_corellia.pln', direction: [1, 0, 0], size: 5, texture: 'space/planet_corellia.png' },
    { appearance: 'appearance/planet_a_moon_01.pln', direction: [0, 1, 0], size: 9, texture: 'space/planet_a_moon_01.png' },
  ],
  arrival: { kind: 'launch', x: 0, y: 0, z: 0, planet: 'corellia' },
  hyperspace: {
    points: [
      { id: 'point_one', name: 'A Point', description: '', x: 10, y: 0, z: 10, source: 'table' },
      { id: 'point_two', name: 'Corellia: Talus Secta', description: '', x: 3000, y: 0, z: 3000, source: 'table' },
    ],
  },
};
const loner: SpacePack = {
  version: 3,
  zone: 'space_heavy1',
  planet: null,
  title: 'Deep Space',
  stations: [],
  scenery: [],
  planets: [{ appearance: 'appearance/planet_b_moon_02.pln', direction: [0, 0, 1], size: 0.2, texture: 'space/planet_b_moon_02.png' }],
  arrival: { kind: 'point', x: 5, y: 0, z: 5, point: 'far_point' },
  hyperspace: { points: [{ id: 'near_point', name: 'Near Point', description: '', x: 1, y: 0, z: 1, source: 'invented' }, { id: 'far_point', name: 'Far Point', description: '', x: 5, y: 0, z: 5, source: 'invented' }] },
};
const catalogue = new HyperspaceCatalogue([
  { id: 'space_corellia', name: 'Corellia orbit', title: orbit.title, pack: orbit, destinations: destinationsOf(orbit, 'Corellia') },
  { id: 'space_heavy1', name: 'Deep Space', title: loner.title, pack: loner, destinations: destinationsOf(loner, null) },
  { id: 'space_naboo', name: 'Naboo orbit', title: 'Naboo', pack: null, destinations: [] },
]);
const planet = (id: string) => {
  const p = PLANETS.find((x) => x.id === id);
  assert.ok(p, `no planet ${id}`);
  return p;
};
const corellian = systemOf('corellia')!;
ok(destinationFor(corellian, planet('corellia'), catalogue)?.kind === 'launch', 'the world an orbit hangs over is jumped to at that orbit\'s launch point');
ok(destinationFor(corellian, planet('talus'), catalogue)?.id === 'station_two', 'a world with no orbit of its own is jumped to at the station named after it, not at a hyperspace point that also carries its name');
// A second world whose name is two words, and a station whose name merely begins with another
// world's name: the first must be found, the second must not be taken for it.
const twoWords: GalaxySystemDef = { ...fakeSystem('two_words', 'A-2'), zone: 'space_corellia', worlds: [{ planet: 'yavin4' }] };
ok(destinationFor(twoWords, planet('yavin4'), catalogue)?.id === 'station_three', 'a world whose name is two words is found by the whole name');
const notLok: GalaxySystemDef = { ...fakeSystem('not_lok', 'A-3'), zone: 'space_corellia', worlds: [{ planet: 'lok' }] };
ok(destinationFor(notLok, planet('lok'), catalogue)?.kind === 'launch', 'a place whose name merely starts with a world\'s name does not count as named after it');
const deep = systemOf('space_heavy1')!;
ok(destinationFor(deep, planet('space_heavy1'), catalogue)?.id === 'far_point', 'a system that is nobody\'s orbit is jumped to where its own arrival is');
const naboo = systemOf('naboo')!;
ok(destinationFor(naboo, planet('naboo'), catalogue) === null, 'a system whose zone is not converted has nowhere to jump to');
ok(destinationFor(systemOf('mustafar')!, planet('mustafar'), catalogue) === null, 'a world with no orbit at all cannot be jumped to');
ok(zoneFor(corellian, planet('talus')) === 'space_corellia' && zoneFor(corellian, planet('corellia')) === 'space_corellia', 'both worlds of a system are reached through its one zone');

// 5. The globe each system wears: the picture its own pack carries. A moon is never the system's
// picture, even when the pack draws it larger than the world itself.
ok(planetTextureOf(orbit, ['corellia']) === 'space/planet_corellia.png', 'a world wears the picture its pack names for it');
ok(planetTextureOf(orbit, ['nothing_like_it']) === 'space/planet_corellia.png', 'with no name to match, the largest body that is not a moon is worn');
ok(planetTextureOf(loner, ['deep_space']) === null, 'a zone whose only body is a moon wears no picture, and the map tints a globe instead');
ok(planetTextureOf(null, ['corellia']) === null, 'a zone with no pack wears no picture');

console.log(`\n${checks} checks passed`);
