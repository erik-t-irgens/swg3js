// Where a world's map picture lies on its ground (`tools/swg/mapframe.mjs`, `mapFrame` in
// src/ui/spaceMapLayers.ts).
//
// The fault this pins: every picture was drawn over the terrain's whole width about the origin, and
// the client draws an expansion zone's over the buildout area's composite rectangle, moved by the map
// adjustments' offset. Kachirho's picture was drawn 4096 m wide where it covers 2048, and Mustafar's
// 16384 m about the origin where it covers 8000 m about (-2880, 2976), so every place on both looked
// shrunk toward the middle. The ten launch worlds carry no composite and are right as they were.
//
// The tables below are the retail rows' own numbers, typed in; nothing is read from the archives. The
// last section reads the converted packs when there are any and checks what the `maps` command wrote.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mapFrameOf } from '../mapframe.mjs';
import { mapFrame, mapShareX, mapShareY } from '../../../src/ui/spaceMapLayers.ts';

let passed = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;
const root = new URL('../../../', import.meta.url);
const src = (p: string) => readFileSync(new URL(p, root), 'utf8');

/** An areas-table row: the composite and whether the map is allowed there. */
const area = (name: string, composite: [number, number, number, number], allowMap: number, extra: Record<string, unknown> = {}) => ({
  area: name,
  compositeX1: composite[0],
  compositeZ1: composite[1],
  compositeX2: composite[2],
  compositeZ2: composite[3],
  compositeName: composite.every((v) => v === 0) ? '' : name.replace(/_(nw|ne|sw|se)$/, ''),
  allowMap,
  ...extra,
});
const ADJUSTMENTS = [
  { Zone: 'kashyyyk_rryatt_trail__kashyyyk_rryatt_trail_lvl_1_and_2', UnusedMapPixelsOnLeft: 15, unused: 1, offsetX: 0, offsetY: 0 },
  { Zone: 'kashyyyk_main__kashyyyk_main', UnusedMapPixelsOnLeft: 0, unused: 0, offsetX: 0, offsetY: 56 },
];
const PICTURE = { width: 1024, height: 1024 };

// ---------------------------------------------------------------------------------------------
// The converter's rule.
{
  const kachirho = mapFrameOf({ planet: 'kashyyyk_main', areas: [area('kashyyyk_main', [-1024, -1024, 1024, 1024], 1)], adjustments: ADJUSTMENTS, image: PICTURE, terrainWidth: 4096 });
  ok(kachirho.frame === 'composite' && kachirho.width === 2048, `Kachirho's picture covers its composite, 2048 m, not the terrain's 4096 (${kachirho.width})`);
  ok(near(kachirho.centre.x, 0) && near(kachirho.centre.z, 112), `and its middle stands 112 m north, the adjustments' 56 pixels at 2 m a pixel (${kachirho.centre.x}, ${kachirho.centre.z})`);
  ok(kachirho.offset?.y === 56 && kachirho.composite === 'kashyyyk_main', 'the offset it was moved by and the composite it came from are written down');

  const quarters = ['nw', 'ne', 'sw', 'se'].map((q) => area(`mustafar_main_${q}`, [-6880, -1024, 1120, 6976], 1));
  const instances = Array.from({ length: 84 }, (_, i) => area(`mustafar_instance_${i}`, [0, 0, 0, 0], 0));
  const mustafar = mapFrameOf({ planet: 'mustafar', areas: [...quarters, ...instances], adjustments: ADJUSTMENTS, image: PICTURE, terrainWidth: 16384 });
  ok(mustafar.frame === 'composite' && mustafar.width === 8000, `Mustafar's picture is 8000 m across, not 16384 (${mustafar.width})`);
  ok(near(mustafar.centre.x, -2880) && near(mustafar.centre.z, 2976), `about (-2880, 2976), the composite's middle (${mustafar.centre.x}, ${mustafar.centre.z})`);
  ok(!mustafar.offset && !mustafar.others, 'with no adjustment of its own, and its four quarters read as the one composite they share');

  const hunting = mapFrameOf({ planet: 'kashyyyk_hunting', areas: [area('kashyyyk_hunting', [-1422, -1422, 1422, 1422], 1)], adjustments: ADJUSTMENTS, image: PICTURE, terrainWidth: 4096 });
  const deadForest = mapFrameOf({ planet: 'kashyyyk_dead_forest', areas: [area('kashyyyk_dead_forest', [-500, -500, 500, 500], 1)], adjustments: ADJUSTMENTS, image: PICTURE, terrainWidth: 4096 });
  ok(hunting.width === 2844 && deadForest.width === 1000 && near(hunting.centre.z, 0) && near(deadForest.centre.x, 0), "the tree world's sub-zones take theirs too: the hunting grounds 2844 m and the dead forest 1000 m");

  const launch = Array.from({ length: 67 }, (_, i) => area(`naboo_${i}`, [0, 0, 0, 0], 1));
  const naboo = mapFrameOf({ planet: 'naboo', areas: launch, adjustments: ADJUSTMENTS, image: PICTURE, terrainWidth: 16384 });
  ok(naboo.frame === 'terrain' && naboo.width === 16384 && naboo.centre.x === 0 && naboo.centre.z === 0, 'a launch world, whose composite is 0,0,0,0 on every row, keeps the terrain about the origin, as it always was');
  ok(mapFrameOf({ planet: 'nowhere', image: PICTURE, terrainWidth: 8192 }).width === 8192, 'and so does a world with no areas table at all');
  ok(mapFrameOf({ planet: 'x', areas: [area('x', [-100, -100, 100, 100], 0)], image: PICTURE, terrainWidth: 4096 }).frame === 'terrain', "a composite on a row the map is not allowed on is not the map's (the client's own rule)");

  const flat = mapFrameOf({ planet: 'y', areas: [area('y', [-200, -100, 200, 100], 1)], image: PICTURE, terrainWidth: 4096 });
  ok(flat.width === 400 && flat.height === 200, 'a composite that is not square says so, and its width is the larger side');
  const two = mapFrameOf({ planet: 'z', areas: [area('z_a', [-10, -10, 10, 10], 1), area('z_b', [0, 0, 50, 50], 1), area('z_b2', [0, 0, 50, 50], 1)], image: PICTURE, terrainWidth: 4096 });
  ok(two.width === 50 && two.others?.length === 1, 'two different composites allowed a map: the one more rows carry is drawn and the other is named');
  const sideways = mapFrameOf({ planet: 's', areas: [area('s', [-500, -500, 500, 500], 1)], adjustments: [{ Zone: 's__s', offsetX: 10, offsetY: 0 }], image: { width: 500, height: 1000 }, terrainWidth: 4096 });
  ok(near(sideways.centre.x, 20) && near(sideways.centre.z, 0), "an offset's pixels are the picture's own, at the metres a pixel each side gives");
}

// ---------------------------------------------------------------------------------------------
// The game's one frame, which all three readers place through.
{
  const old = mapFrame({ width: 16384 });
  ok(old.x === 0 && old.z === 0 && old.width === 16384, 'a map.json with no centre reads as the origin: an old pack draws exactly as it did');
  ok(mapFrame(null).width === 16384 && mapFrame({ width: 'nonsense' }).width === 16384 && mapFrame({ width: -5 }).width === 16384, 'and a width that is missing or nonsense reads as the planet-wide 16384 every reader fell back on');
  ok(mapFrame({ width: 2048, centre: { x: 0, z: 112 } }).z === 112 && mapFrame({ width: 2048, centre: { x: 'a', z: null } }).x === 0, 'a centre is taken as written, and a part of one that is not a number reads as nought');
  // The old placing, (x + w/2)/w and (w/2 - z)/w, is the new one about the origin.
  let same = true;
  for (const [x, z] of [[0, 0], [1200, -3000], [-8000, 8000], [123.4, 56.7]]) {
    if (!near(mapShareX(old, x), (x + 8192) / 16384, 1e-12) || !near(mapShareY(old, z), (8192 - z) / 16384, 1e-12)) same = false;
  }
  ok(same, 'about the origin the shares are exactly the old ones, so the launch worlds move by nothing');
  const kachirho = mapFrame({ width: 2048, centre: { x: 0, z: 112 } });
  ok(mapShareX(kachirho, -1024) === 0 && mapShareX(kachirho, 1024) === 1 && near(mapShareY(kachirho, 112 + 1024), 0) && near(mapShareY(kachirho, 112 - 1024), 1), "on Kachirho the picture's edges are the composite's edges, moved 112 m north");
  const mustafar = mapFrame({ width: 8000, centre: { x: -2880, z: 2976 } });
  ok(near(mapShareX(mustafar, -2880), 0.5) && near(mapShareY(mustafar, 2976), 0.5), "Mustafar's composite middle is the picture's middle");
  // A place at 500 m east: drawn at 53% of the picture under the old rule, 56% under the new one.
  ok(mapShareX(mapFrame({ width: 4096 }), 500) < mapShareX(kachirho, 500), 'the same place sits further from the middle once the picture is the right size: the places no longer look shrunk');
}

// ---------------------------------------------------------------------------------------------
// The readers and the converter use it.
{
  // Every map reads its picture through one shared loader now (`mapImages.ts`), which is where map.json
  // becomes a frame; the readers below are checked to go through it rather than reading map.json again.
  const images = src('src/ui/mapImages.ts');
  ok((images.match(/frame: mapFrame\(meta\)/g) ?? []).length === 1, 'the one shared loader turns map.json into its frame');
  const mapUi = src('src/ui/mapUi.ts');
  ok(/mapPicture\(packId\)/.test(mapUi) && !/map\.json/.test(mapUi.replace(/\/\/.*$/gm, '')) && /this\.toScreen\(frame\.x - extent \/ 2, frame\.z \+ extent \/ 2\)/.test(mapUi), "the map window takes its picture from the shared loader and draws it about the frame's middle");
  ok(!/this\.image\?\.width/.test(mapUi), 'and nothing in it reads a bare width any more');
  const galaxy = src('src/ui/galaxyMap.ts');
  ok(/mapShareX\(frame, poi\.x\)/.test(galaxy) && /mapShareY\(frame, poi\.z\)/.test(galaxy) && !/extent \/ 2 - poi\.z/.test(galaxy), "the galaxy map's thumbnail dots are placed through the frame");
  const terminal = src('src/ui/terminalUi.ts');
  ok((terminal.match(/mapShareX\(f, p\.x\)/g) ?? []).length === 2 && !/mapWidth/.test(terminal), "both of the terminal's dot layouts are placed through the frame");
  const main = src('src/main.ts');
  ok(/mapFrame: meta\?\.frame \?\? mapFrame\(null\)/.test(main) && /return mapMeta\(pack\)/.test(main), 'the terminal is handed the frame its map.json gives, through the shared loader');
  ok(/return mapMeta\(packId\)/.test(galaxy), "and so are the galaxy map's thumbnails");
  const cli = src('tools/swg/cli.mjs');
  ok(/mapFrameOf\(\{ planet, areas: mapTable\(`datatables\/buildout\/areas_\$\{planet\}\.iff`\), adjustments/.test(cli) && /map_adjustments\.iff/.test(cli), 'the maps command reads the areas table and the map adjustments');
  ok(/centre: frame\.centre, frame: frame\.frame/.test(cli), 'and writes the centre and the frame into map.json');
  ok(/const unframed = GAME_PLANETS\.filter/.test(cli) && /return m && m\.image && !m\.frame/.test(cli), 'status asks for the maps again while a map.json carries no frame');
}

// ---------------------------------------------------------------------------------------------
// What the maps command wrote, where there are converted packs.
{
  const packs = new URL('assets-private/', root);
  const read = (w: string) => {
    const f = new URL(`${w}/map.json`, packs);
    return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
  };
  const kachirho = read('kashyyyk_main');
  if (!kachirho) console.log('note: no converted kashyyyk_main map; the packs are not checked');
  else if (!kachirho.frame) console.log('note: the packs\' maps were written before the frame was read; run the maps command to check them');
  else {
    ok(kachirho.frame === 'composite' && kachirho.width === 2048 && kachirho.centre.x === 0 && kachirho.centre.z === 112, `kashyyyk_main's map.json: 2048 m about (0, 112) (${kachirho.width} about ${kachirho.centre.x}, ${kachirho.centre.z})`);
    const mustafar = read('mustafar');
    if (mustafar) ok(mustafar.frame === 'composite' && mustafar.width === 8000 && mustafar.centre.x === -2880 && mustafar.centre.z === 2976, `mustafar's: 8000 m about (-2880, 2976)`);
    const hunting = read('kashyyyk_hunting');
    const dead = read('kashyyyk_dead_forest');
    if (hunting && dead) ok(hunting.width === 2844 && dead.width === 1000, 'the hunting grounds and the dead forest take their own');
    const launch = ['tatooine', 'naboo', 'corellia', 'yavin4'].map(read).filter(Boolean);
    ok(launch.every((m) => m.frame === 'terrain' && m.centre.x === 0 && m.centre.z === 0 && m.width === 16384), `the launch worlds are over their terrain about the origin as before (${launch.length} checked)`);
    // Every place of the composite worlds lands on its picture, and spread wider across it than before.
    for (const w of ['kashyyyk_main', 'mustafar']) {
      const meta = read(w);
      const poisFile = new URL(`${w}/pois.json`, packs);
      if (!meta || !existsSync(poisFile)) continue;
      const pois = (JSON.parse(readFileSync(poisFile, 'utf8')).pois ?? []) as { x: number; z: number }[];
      const f = mapFrame(meta);
      const on = pois.filter((p) => mapShareX(f, p.x) >= 0 && mapShareX(f, p.x) <= 1 && mapShareY(f, p.z) >= 0 && mapShareY(f, p.z) <= 1).length;
      const spread = (fr: typeof f) => Math.max(...pois.map((p) => mapShareX(fr, p.x))) - Math.min(...pois.map((p) => mapShareX(fr, p.x)));
      const before = spread(mapFrame({ width: meta.terrainWidth }));
      ok(on === pois.length && spread(f) > before * 1.5, `${w}: all ${pois.length} places are on its picture, spread over ${(spread(f) * 100).toFixed(0)}% of it where they were over ${(before * 100).toFixed(0)}%`);
    }
  }
}

console.log(`\nmapFrame: ${passed} checks passed`);
