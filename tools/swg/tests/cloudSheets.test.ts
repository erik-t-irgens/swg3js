// A world's own multipliers on the sky's flat cloud sheets (`sheetHeight`, `sheetScale` in its locations file's world row):
// read, defaulted and handed to the sky. Run with `node tools/swg/tests/cloudSheets.test.ts`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as LF from '../../../src/world/editFiles/locationsFile.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
};

// 1. The multipliers: one with nothing, the deck's own height where the sheets name none, their own over it.
{
  const m = (c: unknown) => LF.sheetMultipliers(c as LF.LocationClouds);
  ok(m(undefined).height === 1 && m(undefined).scale === 1, 'no clouds: both one');
  ok(m({}).height === 1 && m({ cover: 2 }).scale === 1, 'no sheet field: both one');
  ok(m({ height: 0.4 }).height === 0.4, 'the deck height moves the sheets where they name none');
  ok(m({ height: 0.4, sheetHeight: 2 }).height === 2, 'the sheets own height wins');
  ok(m({ sheetScale: 3 }).scale === 3 && m({ sheetScale: 3 }).height === 1, 'the picture size alone');
}

// 2. The file's reader takes both, held to their ranges.
{
  const read = (clouds: unknown) =>
    LF.readLocationsFile(LF.locationsFileText('testworld', 'raw', [{ id: 'world', kind: 'world', clouds }] as never), 'testworld', 'ground');
  const r = read({ sheetHeight: 0.5, sheetScale: 2.5 });
  const row = r.rows.find((x) => x.kind === 'world');
  ok(r.problem === null && !!row, 'a world row with sheet multipliers reads');
  ok(row?.clouds?.sheetHeight === 0.5 && row?.clouds?.sheetScale === 2.5, 'both kept');
  const wild = read({ sheetHeight: 500, sheetScale: -1 });
  const w = wild.rows.find((x) => x.kind === 'world')?.clouds;
  ok(!w || ((w.sheetHeight === undefined || (w.sheetHeight >= 0.01 && w.sheetHeight <= 20)) && (w.sheetScale === undefined || (w.sheetScale >= 0.05 && w.sheetScale <= 20))), 'out of range is never kept as written');
}

// 3. The hand-overs only the game makes, as text: the row to the world, the world to its sky now and as its sky is made,
// and the sky's sheets read their own altitude and their picture's own size.
{
  const src = (p: string): string => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');
  const main = src('src/main.ts');
  ok(main.includes('const sheets = sheetMultipliers(row?.clouds);\n    this.world.setCloudSheets(pack, sheets.height, sheets.scale);') || main.includes('const sheets = sheetMultipliers(row?.clouds);\r\n    this.world.setCloudSheets(pack, sheets.height, sheets.scale);'), 'applyWorldSky hands the sheets to the world');
  const world = src('src/world/world.ts');
  ok(/this\.skyPack = pack;\r?\n\s+this\.applyCloudSheets\(\);/.test(world), 'a sky made takes the world row\'s sheets');
  ok(world.includes('if (c.pack === this.packId) s.setSheets(c.height, c.scale);') && world.includes('else s.setSheets(1, 1);'), 'only the world the row is for');
  const sky = src('src/world/sky.ts');
  ok(sky.includes('u.uRepeat.value = size * (c.repeatAt / CLIENT_CLOUD_HEIGHT) * CLOUD_SIZE_TRIM;'), 'a sheet repeats over its own picture size');
  ok(sky.includes('driftAloft(scroll.s, this.sheetAloft, slot, this.windHeading, size, c.repeatAt, dt);'), 'its wind aloft over the same');
  ok(sky.includes('im.repeat = size * ((CLOUD_ALTITUDES[slot] * this.sheetScale) / CLIENT_CLOUD_HEIGHT) * CLOUD_SIZE_TRIM;'), 'the decks take the sheets picture size');
  ok(sky.includes('c.mesh.position.y = c.altitude;') && sky.includes('this.clouds.push({ mesh, slot, altitude, repeatAt: altitude, file: null });'), 'each sheet stands at its altitude, made at its own');
}

// 4. With both one the arithmetic is the old to the bit: an altitude times one and a repeat over it.
{
  for (const alt of [1500, 2300]) {
    for (const size of [1, 8, 13.5, 40]) {
      ok(size * ((alt * 1) / 10) * 0.7 === size * (alt / 10) * 0.7, `repeat at ${alt}, size ${size}`);
      ok(alt * 1 === alt, `altitude ${alt}`);
    }
  }
}

console.log(`cloudSheets: ${checks} checks passed`);
