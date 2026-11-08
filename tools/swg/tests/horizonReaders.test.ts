// The horizon pass's second wave: what reads the far ground (DESIGN.md §2.9, §4 Tests). `heightIfCached` with no field
// is PRE_PASS's (4c2ba23's `swgTerrain.ts` loaded out of git beside today's, at points a block answers, a far grid answers
// and nothing answers); with a field, the block's to the bit where a block answers and the bake's bilinear past it
// (`bakeHeightAt`'s own answer); a far body's ground (`groundProbe`'s rule) found kilometres out where it was unknown;
// and the editor's aim marches the terrain through the very `heightIfCached`.
//
// Run: node tools/swg/tests/horizonReaders.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bakeHeightAt, type BakeGrid } from '../../../src/world/horizon/horizonMath.ts';
import { HorizonField } from '../../../src/world/horizon/horizonField.ts';
import { groundUnder } from '../../../src/world/mobiles/groundProbe.ts';
import type { SwgTerrain } from '../../../src/world/swgTerrain.ts';
import { bakedWorlds, loadBaked, repo } from './horizonWorld.ts';
import { loadOld } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);
const PRE_PASS = '4c2ba23';

// The editor's aim marches the terrain through `heightIfCached` (its fifth step), so the bake answers it past the colliders.
const aim = readFileSync(join(repo, 'src/editor/aim.ts'), 'utf8');
ok(/heightIfCached/.test(aim), "the editor's aim marches the terrain through heightIfCached, which the bake answers past the blocks");

const worlds = bakedWorlds();
if (!worlds.length) note('no baked world on disk: the readers are skipped');
else {
  const w = (await loadBaked(worlds[0]))!;
  const swg = w.swg;
  const H = w.header;
  const fine: BakeGrid = { x0: H.fine.x0, z0: H.fine.z0, step: H.fine.step, nx: H.fine.nx, nz: H.fine.nz, h: w.fine };
  const coarse: BakeGrid = { x0: H.coarse.x0, z0: H.coarse.z0, step: H.coarse.step, nx: H.coarse.nx, nz: H.coarse.nz, h: w.coarse };
  // Places in the game's frame: a block made at the middle, a far grid made 3 km out, nothing made 6 km out.
  const near = { x: 37, z: -51 };
  swg.heightAt(near.x, near.z);
  const sh = swg.groundShift;
  const farO = { x: 3 * 1024 + sh.x, z: -2 * 1024 + sh.z };
  swg.farGrid(farO.x, farO.z, 512, 32, true);
  const pts: { x: number; z: number; kind: string }[] = [];
  for (let k = 0; k < 40; k++) pts.push({ x: near.x + (k % 7) * 3.3 - 9, z: near.z + Math.floor(k / 7) * 2.9 - 8, kind: 'block' });
  for (let k = 0; k < 40; k++) pts.push({ x: farO.x + 20 + (k % 7) * 63.1, z: farO.z + 30 + Math.floor(k / 7) * 71.3, kind: 'far grid' });
  for (let k = 0; k < 20; k++) pts.push({ x: 6000 + k * 37.7, z: 5800 - k * 11.3, kind: 'nothing' });
  // Every block point's block made, so a block answers each.
  for (const p of pts) if (p.kind === 'block') swg.heightAt(p.x, p.z);
  type Old = { SwgTerrain: { prototype: { heightIfCached: SwgTerrain['heightIfCached'] } } };
  const old = await loadOld<Old>(['src/world/swgTerrain.ts'], 'src/world/swgTerrain.ts', PRE_PASS);
  if (!old) note(`git cannot hand ${PRE_PASS}'s swgTerrain.ts over: the day-one comparison is skipped`);
  else {
    let diff = 0;
    for (const p of pts) {
      const a = swg.heightIfCached(p.x, p.z, 512, 32);
      const b = old.SwgTerrain.prototype.heightIfCached.call(swg, p.x, p.z, 512, 32);
      if (!Object.is(a, b)) diff++;
    }
    ok(diff === 0, `${w.name}: with no field heightIfCached is ${PRE_PASS}'s to the bit at a block, a far grid and nowhere (${pts.length} points)`);
  }
  const before = pts.map((p) => swg.heightIfCached(p.x, p.z, 512, 32));
  ok(before.slice(80).every((v) => v === null), `${w.name}: kilometres past the far grids nothing answers today`);
  // A field: the bake's heights through the field's own reader (its lerp, written out), held to `bakeHeightAt`, NaN past both lattices.
  const field = new HorizonField(w.name, w.centre, swg.groundShift);
  Object.assign(field as unknown as Record<string, unknown>, { header: H, fineH: w.fine, coarseH: w.coarse });
  let readBad = 0;
  for (let k = 0; k < 3000; k++) {
    const rx = H.coarse.x0 + (k * 7919.3) % ((H.coarse.nx - 1) * H.coarse.step);
    const rz = H.coarse.z0 + (k * 6271.7) % ((H.coarse.nz - 1) * H.coarse.step);
    if (!Object.is(field.heightRaw(rx, rz), bakeHeightAt(fine, coarse, rx, rz))) readBad++;
  }
  ok(readBad === 0 && Number.isNaN(field.heightRaw(H.coarse.x0 - 10, 0)), "the field's own reader is bakeHeightAt's answer at 3,000 places, and NaN past both lattices");
  swg.horizon = field;
  let blockSame = 0;
  let bakeSame = 0;
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k];
    const v = swg.heightIfCached(p.x, p.z, 512, 32);
    if (p.kind === 'block') {
      if (Object.is(v, before[k])) blockSame++;
    } else if (Object.is(v, bakeHeightAt(fine, coarse, swg.toSwgX(p.x), swg.toSwgZ(p.z)))) bakeSame++;
  }
  ok(blockSame === 40, `${w.name}: with a field a block answers as it did, to the bit`);
  ok(bakeSame === 60, `${w.name}: past the blocks the bake's bilinear answers, before a far grid and where nothing did (${bakeSame} points)`);
  // The far grid's 16 m answer against the bake's 8 m, where both answer: the bake nearer the true ground (§2.9).
  let worst = 0;
  for (let k = 40; k < 80; k++) worst = Math.max(worst, Math.abs((swg.heightIfCached(pts[k].x, pts[k].z, 512, 32) as number) - (before[k] as number)));
  note(`${w.name}: the bake's answer stands within ${worst.toFixed(2)} m of the far grid's at its forty points`);
  // A far body's ground (`groundProbe`): unknown kilometres out with no field, the bake's height with one.
  const body = { x: 6100, z: 5700 };
  const terrain = { heightAt: (x: number, z: number) => swg.heightAt(x, z) };
  const world = { groundIfCached: (x: number, z: number) => swg.heightIfCached(x, z, 512, 32), groundSolid: () => false };
  const withField = groundUnder(body.x, body.z, terrain, world);
  swg.horizon = null;
  const without = groundUnder(body.x, body.z, terrain, world);
  ok(without === null && typeof withField === 'number' && Number.isFinite(withField), `${w.name}: a far body's ground kilometres out is found with the field (${(withField as number).toFixed(1)} m) where it was unknown`);
}

console.log(`\nhorizonReaders: ${checks} checks passed`);
