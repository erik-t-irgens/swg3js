// Lakes of ours (Map-maker II's fifth wave, DESIGN.md §2.7, `src/world/ourWater.ts`): what the game's every water reader
// takes from a lake of the water file. Held here:
// - the cell index answers exactly as the full crossing test over 100,000 points of six shapes (convex, concave, a star, a
//   comb, a traced-like ring of 300 points, one wider than tall), inside and outside the box;
// - the higher surface wins and the earliest table on a tie, over a list and over a real world's own tables appended to
//   (`SwgTerrain.setOurWater`): a lake answers `waterAt` inside and never outside, a client table over it still wins where
//   it is higher, and with `setOurWater([])` the tables are the client's own array again;
// - the real-elevation list (`Terrain.lakes`): `waterHeightAt` and `waterTableAt` name a lake of ours on a world with no
//   converted terrain, which reading `swg` alone answered nothing on;
// - the sea nudge (`nudgedLevel`): a lake within a centimetre of the global sea's height is raised clear of it, so the
//   float-exact sea test (`onSeaSurface`) never reads it as the sea;
// - a landing's plan (`planLakeLanding`): the lakes in force by id and exactly the ids that moved.
//
// Run: node tools/swg/tests/ourWater.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SwgTerrain } from '../../../src/world/swgTerrain.ts';
import { Terrain } from '../../../src/world/terrain.ts';
import { LAKE_TUNE, inLakeCells, keptTables, lakeCells, lakeTable, landingTouchesLava, lookOver, planLakeLanding, pointInLake, surfaceOf, tableCovers, tableOf, underLakes, type LakeTable } from '../../../src/world/ourWater.ts';
import { onSeaSurface } from '../../../src/world/waterLineMath.ts';
import { nudgedLevel, clickLevel } from '../../../src/editor/editorWater.ts';
import type { WaterLakeRow } from '../../../src/world/editFiles/waterFile.ts';
import type { PlanetDef } from '../../../src/data/planets.ts';
import { groundWorlds, PACKS } from './terrainHarness.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);

/** A seeded generator, so a failure names the same shape every run. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const row = (id: string, h: number, points: [number, number][], extra: Partial<WaterLakeRow> = {}): WaterLakeRow => ({ id, kind: 'lake', h, points, shader: null, ...extra });
const ident = (v: number) => v;

{
  // The index against the full test.
  const shapes: Record<string, [number, number][]> = {
    square: [[0, 0], [100, 0], [100, 100], [0, 100]],
    concave: [[0, 0], [120, 0], [120, 120], [60, 30], [0, 120]],
    star: Array.from({ length: 20 }, (_, i) => {
      const r = i % 2 ? 40 : 140;
      const a = (i / 20) * Math.PI * 2;
      return [Math.cos(a) * r + 7.3, Math.sin(a) * r - 3.1] as [number, number];
    }),
    comb: [[0, 0], [200, 0], [200, 10], [190, 10], [190, 100], [170, 100], [170, 10], [130, 10], [130, 100], [110, 100], [110, 10], [70, 10], [70, 100], [50, 100], [50, 10], [0, 10]],
    traced: (() => {
      const r = rng(7);
      return Array.from({ length: 300 }, (_, i) => {
        const a = (i / 300) * Math.PI * 2;
        const rad = 800 + 200 * Math.sin(a * 5) + 60 * (r() - 0.5);
        return [Math.cos(a) * rad + 2000, Math.sin(a) * rad - 1500] as [number, number];
      });
    })(),
    wide: [[-900, -5], [900, -5], [900, 5], [-900, 5]],
  };
  for (const [name, pts] of Object.entries(shapes)) {
    const t = lakeTable(row(name, 10, pts), ident, ident, () => false, LAKE_TUNE.cell);
    const r = rng(name.length * 977);
    const w = t.maxX - t.minX;
    const d = t.maxZ - t.minZ;
    let differ = 0;
    let inside = 0;
    for (let i = 0; i < 100000 / 6; i++) {
      // A tenth of the points beyond the box, the rest within it, some on the index's own cell lines.
      const x = t.minX - w * 0.05 + r() * w * 1.1;
      const z = i % 50 === 0 ? t.cells!.oz + Math.floor(r() * t.cells!.nz) * t.cells!.size : t.minZ - d * 0.05 + r() * d * 1.1;
      const full = pointInLake(x, z, t.points);
      const fast = tableCovers(t, x, z);
      if (full) inside++;
      if (full !== fast) differ++;
    }
    ok(differ === 0 && inside > 0, `${name}: the cell index answers as the full crossing test at every one of ${Math.floor(100000 / 6)} points (${inside} inside)`);
  }
  const t = lakeTable(row('square', 10, shapes.square), ident, ident);
  ok(t.cells!.state.includes(1) && t.cells!.state.includes(2), 'a lake\'s index holds cells wholly in and cells an edge crosses');
  ok(inLakeCells(t.cells!, t.points, 50, 50) && !inLakeCells(t.cells!, t.points, 500, 50), 'and a point outside its grid asks the full test');
  const c = lakeCells(t.points, t.minX, t.maxX, t.minZ, t.maxZ, 0.1);
  ok(c.size === 0.5, 'a cell under half a metre is held at half a metre');
}

{
  // The rule over a list: the higher wins, the earliest on a tie; under a lake past floraUnder; a look laid over.
  const a = lakeTable(row('a', 10, [[0, 0], [100, 0], [100, 100], [0, 100]]), ident, ident);
  const b = lakeTable(row('b', 12, [[50, 0], [150, 0], [150, 100], [50, 100]]), ident, ident);
  const c = lakeTable(row('c', 12, [[60, 0], [160, 0], [160, 100], [60, 100]]), ident, ident);
  ok(surfaceOf([a, b, c], 25, 50) === 10 && surfaceOf([a, b, c], 75, 50) === 12 && surfaceOf([a, b, c], 300, 50) === -Infinity, 'surfaceOf: the higher of the tables covering a point, nothing outside them');
  ok(surfaceOf([a], 25, 50, 20) === 20, 'and never under the level it is handed (the client\'s own)');
  ok(tableOf([a, b, c], 75, 50) === b && tableOf([a, b, c], 25, 50) === a && tableOf([a, b, c], 300, 50) === null, 'tableOf: the highest table, the earliest of two on a tie');
  ok(underLakes([a], 50, 50, 10 - LAKE_TUNE.floraUnder - 0.01) && !underLakes([a], 50, 50, 10 - LAKE_TUNE.floraUnder + 0.01) && !underLakes([a], 500, 50, -100), `a planting is under a lake of ours past ${LAKE_TUNE.floraUnder} m of its water, and never outside it`);
  const base = { color: '#112233', opacity: 0.5, ripple: 1, drift: 1, extra: 'kept' };
  const over = lookOver(base, { opacity: 0.9, drift: 2 });
  ok(over.color === '#112233' && over.opacity === 0.9 && over.ripple === 1 && over.drift === 2 && over.extra === 'kept' && lookOver(base, undefined) === base, "a lake's own look moves only the numbers it names, and with none it is its shader's to the object");
}

{
  // The sea nudge and a clicked lake's level.
  const n = nudgedLevel(5, 5, 0.01);
  ok(n.nudged && n.h === 5.01 && !onSeaSurface(n.h, 5, true), 'a lake at the sea\'s own height is raised a centimetre, so the sea test never reads it as the sea');
  ok(!nudgedLevel(5.2, 5, 0.01).nudged && nudgedLevel(5.2, 5, 0.01).h === 5.2 && !nudgedLevel(5, -Infinity, 0.01).nudged, 'and a lake clear of it, or a world with no sea, is left as it is');
  ok(clickLevel([3, 1, 2], 'lowest', 9, 0.5) === 1.5 && clickLevel([3, 1, 2], 'first', 9, 0.5) === 3.5 && clickLevel([3, 1, 2], 'typed', 9, 0.5) === 9 && Number.isNaN(clickLevel([], 'lowest', 9, 0)), "a clicked lake's level: the lowest ground under its points, the first point's, or the typed height");
}

{
  // A landing's plan.
  const was = [row('b', 1, [[0, 0], [1, 0], [0, 1]]), row('a', 1, [[0, 0], [1, 0], [0, 1]])];
  const p = planLakeLanding(was, [row('c', 2, [[0, 0], [1, 0], [0, 1]]), row('a', 3, [[0, 0], [1, 0], [0, 1]])], ['b', 'zz']);
  ok(p.rows.map((r) => r.id).join() === 'a,c' && p.rows[0].h === 3, 'a landing leaves the lakes in force by id, each as it was put');
  ok([...p.moved].sort().join() === 'a,b,c', 'and exactly the ids put or taken out moved (one never there moves nothing)');
  ok(planLakeLanding(was, [], []).moved.size === 0, 'a landing of nothing moves nothing');

  // The tables after it (`keptTables`, `World.ourTablesOf`): an unmoved lake keeps its very table, so the lava's set and the
  // looks, which know a table by itself, keep knowing it across another lake's landing; a moved one is made afresh.
  const toX = (x: number) => -x;
  const toZ = (z: number) => z;
  let made = 0;
  const make = (r: WaterLakeRow) => {
    made++;
    return lakeTable(r, toX, toZ, (s) => s === 'lava_flow');
  };
  const lavaRow = { ...row('l', 5, [[0, 0], [9, 0], [0, 9]]), shader: 'lava_flow' };
  const first = keptTables([] as LakeTable[], [lavaRow, ...was], null, make);
  ok(first.length === 3 && made === 3 && first[0].waterType === 1, 'at an arrival every lake is made');
  const p2 = planLakeLanding([lavaRow, ...was], [row('a', 4, [[0, 0], [1, 0], [0, 1]])], []);
  made = 0;
  const after = keptTables(first, p2.rows, p2.moved, make);
  const lavaAfter = after.find((t) => t.ours?.id === 'l')!;
  ok(lavaAfter === first.find((t) => t.ours?.id === 'l') && after.find((t) => t.ours?.id === 'b') === first.find((t) => t.ours?.id === 'b'), "another lake's landing leaves the lava lake's table and every other unmoved one the very same object (so `lavaTables.has` still finds it)");
  ok(made === 1 && after.find((t) => t.ours?.id === 'a') !== first.find((t) => t.ours?.id === 'a') && after.find((t) => t.ours?.id === 'a')!.height === 4, 'and the moved lake alone is made afresh');
  const sameRow = keptTables(first, [lavaRow, ...was], new Set(['l']), make);
  ok(sameRow.find((t) => t.ours?.id === 'l') !== first.find((t) => t.ours?.id === 'l'), 'a lake named moved is made afresh even where its row is the very same object');
  const left = keptTables(first, [lavaRow, ...was], new Set(['l']), () => null);
  ok(left.length === 2 && !left.some((t) => t.ours?.id === 'l'), 'and a lake its making leaves out (lava on a world that draws none) has no table');

  // Whether a landing makes the lava again (`landingTouchesLava`): a lava lake put, or one standing as lava put or taken out.
  const isLava = (s: string) => s === 'lava_flow';
  ok(landingTouchesLava(first, [{ ...row('new', 1, [[0, 0], [1, 0], [0, 1]]), shader: 'lava_flow' }], [], isLava), 'a lava lake put makes the lava again');
  ok(landingTouchesLava(first, [], ['l'], isLava), 'so does a lava lake taken out (an undo of its putting)');
  ok(landingTouchesLava(first, [{ ...lavaRow, shader: null }], [], isLava), 'and a lava lake made water (it leaves the lava)');
  ok(!landingTouchesLava(first, [row('a', 6, [[0, 0], [1, 0], [0, 1]])], ['b'], isLava), 'a lake of water moved and another taken out leave the lava as it is');
}

{
  // A real-elevation world: the terrain's own list.
  const planet = { id: 'dem-test', seed: 1, palette: { low: 0x808080, mid: 0x808080, high: 0x808080, slope: 0x808080, shore: 0x808080 }, terrain: { base: 0, amplitude: 10, frequency: 0.01, octaves: 1, ridged: 0, flatten: 1, detail: 0 }, water: { level: -5 } } as unknown as PlanetDef;
  const t = new Terrain(planet);
  ok(t.waterHeightAt(10, 10) === -5 && t.waterTableAt(10, 10) === null, 'with no lake, the planet\'s own level and no table');
  const lake = lakeTable(row('pond', 20, [[0, 0], [-50, 0], [-50, 50], [0, 50]]), (x) => -x, (z) => z) as LakeTable;
  t.lakes.push(lake);
  ok(t.waterHeightAt(25, 25) === 20 && t.waterTableAt(25, 25) === lake, 'a lake of ours on the list answers waterHeightAt and waterTableAt (raw x mirrored about nought)');
  ok(t.waterHeightAt(-25, 25) === -5 && t.waterTableAt(-25, 25) === null, 'and outside it, the planet\'s own');
  t.lakes.length = 0;
}

{
  // A real world's own tables, a lake appended after them.
  const worlds = groundWorlds();
  let held = 0;
  for (const world of worlds) {
    const file = join(PACKS, world, 'layout.json');
    if (!existsSync(file)) continue;
    const m = /"center"\s*:\s*\{\s*"x"\s*:\s*(-?[\d.]+)\s*,\s*"z"\s*:\s*(-?[\d.]+)/.exec(readFileSync(file, 'utf8').slice(0, 8000));
    const trnFile = join(PACKS, world, 'terrain.trn');
    if (!m || !existsSync(trnFile)) continue;
    const bytesOf = (f: string): ArrayBuffer | null => {
      if (!existsSync(f)) return null;
      const b = readFileSync(f);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    };
    const swg = await SwgTerrain.create(bytesOf(trnFile)!, [], Number(m[1]), Number(m[2]), async (f: string) => bytesOf(join(PACKS, world, f)));
    const client = swg.waterTables.filter((w) => w.points.length >= 3);
    if (!client.length) continue;
    const before = [...swg.waterTables];
    // Over the client's first table, a lake 30 m higher round its first point, and one at exactly its height covering it.
    const w = client[0];
    const p = w.points[0];
    const raw = (gx: number, gz: number): [number, number] => [swg.toSwgX(gx), swg.toSwgZ(gz)];
    const high = lakeTable(row('high', w.height + 30, [raw(p.x - 20, p.z - 20), raw(p.x + 20, p.z - 20), raw(p.x + 20, p.z + 20), raw(p.x - 20, p.z + 20)]), (x) => swg.toGameX(x), (z) => swg.toGameZ(z));
    const tie = lakeTable(row('tie', w.height, [raw(w.minX - 5, w.minZ - 5), raw(w.maxX + 5, w.minZ - 5), raw(w.maxX + 5, w.maxZ + 5), raw(w.minX - 5, w.maxZ + 5)]), (x) => swg.toGameX(x), (z) => swg.toGameZ(z));
    swg.setOurWater([high, tie] as never);
    ok(swg.waterTables.length === before.length + 2 && swg.waterTables.slice(0, before.length).every((t, i) => t === before[i]), `${world}: a lake of ours is appended after the client's own tables, which keep their order`);
    ok(swg.waterAt(p.x, p.z) === w.height + 30 && swg.waterTableAt(p.x, p.z) === (high as never), `${world}: inside it the higher lake of ours is the surface and the table`);
    ok(swg.waterAt(p.x + 200, p.z + 200) !== w.height + 30, `${world}: and outside it, never`);
    // At a point of the client's table that the high lake does not cover, the tie goes to the earlier table, the client's.
    let tieChecked = false;
    for (let k = 0; k < 400 && !tieChecked; k++) {
      const x = w.minX + ((k * 37) % 100) / 100 * (w.maxX - w.minX);
      const z = w.minZ + ((k * 61) % 100) / 100 * (w.maxZ - w.minZ);
      if (!pointInLake(x, z, w.points) || tableCovers(high, x, z)) continue;
      const own = swg.waterTableAt(x, z);
      if (own && own.height > w.height) continue;
      ok(own === w, `${world}: on a tie of heights the client's own table, the earlier, is the one named`);
      tieChecked = true;
    }
    ok(swg.ourWater().length === 2, `${world}: ourWater() lists the lakes of ours`);
    swg.setOurWater([]);
    ok(swg.waterTables.length === before.length && swg.waterTables.every((t, i) => t === before[i]) && swg.ourWater().length === 0, `${world}: and with none set again, the tables are the client's own as read`);
    // The terrain's own answer is the converted terrain's to the bit.
    const planet = { id: world, seed: 1, palette: { low: 0, mid: 0, high: 0, slope: 0, shore: 0 }, terrain: { base: 0, amplitude: 10, frequency: 0.01, octaves: 1, ridged: 0, flatten: 1, detail: 0 }, water: null } as unknown as PlanetDef;
    const terrain = new Terrain(planet);
    terrain.attachSwg(swg);
    let same = true;
    for (let k = 0; k < 500; k++) {
      const x = -3000 + ((k * 7919) % 6000) + 0.31;
      const z = -3000 + ((k * 104729) % 6000) - 0.77;
      if (terrain.waterTableAt(x, z) !== swg.waterTableAt(x, z) || !Object.is(terrain.waterHeightAt(x, z), swg.waterAt(x, z))) same = false;
    }
    ok(same, `${world}: Terrain.waterTableAt and waterHeightAt are the converted terrain's own answers at 500 points`);
    held++;
    if (held >= 3) break;
  }
  if (!held) note(`no converted world with water tables under ${PACKS}: the appended lake is not checked on a real world`);
}

console.log(`ourWater: ${checks} checks passed`);
