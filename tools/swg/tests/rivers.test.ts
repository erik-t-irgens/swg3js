// Rivers (Map-maker II's sixth wave, DESIGN.md §9 and the owner's amendment of 2026-10-31; `src/world/ourWater.ts`'s
// `riverTable` and its readers, `ribbons.ts`'s `soeRiverRows`, the water file's river rows, `water.ts`'s wind of a reach's
// own). Held here:
//   - a river row of the water file read and written whole, a lake's line as it always was;
//   - a river's quads are the client's own ribbon quads built in the row's raw frame and carried into the game's
//     (`ribbonQuads`, `gameRibbon`) to the bit, each quad's slope its two ends', its reaches the straight runs of its
//     water quads;
//   - the bucket index answers exactly as the walk of every water quad (100,000 points), and the surface over a river
//     equals `ribbonAt`'s over the same quads, on a world with no converted terrain (`Terrain.waterHeightAt`) and on a
//     converted one (`SwgTerrain.waterAt`, the higher of the lakes and the river winning);
//   - the slope limit: a quad past it stands its fall effects and stays water under `'effects'`, and is no water under
//     `'fall'` and `'refuse'`; a river's own `fallFrom` wins over the tune;
//   - the camera's look over a river names its shader (`waterTableAt`'s record carrying its surface there, read by
//     `coveringWaterShader`), and a lake standing higher is the lake's;
//   - a reach's wind is its own object, its material's program key the lake's, its mask twins and current variant
//     sharing it, and the detail it is drawn with runs downstream at the river's own speed;
//   - the terrain's own wet rivers (rivertest's two, watertabletest's one, where the packs are converted) read as rows
//     of the very shape, through the file's own reader, each sample at its height less the water's depth.
//
// Run: node tools/swg/tests/rivers.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readWaterRow, sameWaterRow, waterFileText, readWaterFile, type WaterRiverRow } from '../../../src/world/editFiles/waterFile.ts';
import { RIVER_TUNE, RiverEffectsKeeper, effectScaleOf, reachWind, riverEffects, riverFlowAt, riverLandingPlan, riverRetunePlan, riverScan, riversSurface, riverTable, riverTableAt, tuneRiverTune, underRivers, LAKE_TUNE, type RiverEffect, type RiverFxHost, type RiverHit, type RiverRetune, type RiverTable } from '../../../src/world/ourWater.ts';
import { gameRibbon, inTriangle, mergeClosePoints, planeHeight, ribbonAt, ribbonQuads, soeRiverRows, type GameRibbon, type RibbonPoint, type TerrainRibbon } from '../../../src/swg/terrain/ribbons.ts';
import { coveringWaterShader } from '../../../src/world/waterLineMath.ts';
import { Terrain } from '../../../src/world/terrain.ts';
import { SwgTerrain } from '../../../src/world/swgTerrain.ts';
import { parseTerrainTemplate } from '../../../src/swg/terrain/trn.ts';
import { AffectorRiver, type Layer } from '../../../src/swg/terrain/generator.ts';
import type { PlanetDef } from '../../../src/data/planets.ts';
import { PACKS } from './terrainHarness.ts';
import { REPO } from './airTrees.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string): void => console.log(`note ${s}`);
const ident = (v: number): number => v;
const TUNE0 = { ...RIVER_TUNE };
const resetTune = (): void => {
  Object.assign(RIVER_TUNE, TUNE0);
};

/** A river row of ours read by the file's own reader. */
function river(id: string, points: [number, number, number][], extra: Partial<WaterRiverRow> = {}): WaterRiverRow {
  const r = readWaterRow({ id, kind: 'river', points, width: 8, velocity: 1.5, shader: 'wter_spec', ...extra });
  assert.ok(typeof r !== 'string' && r.kind === 'river', `the reader takes ${id}: ${String(r)}`);
  return r as WaterRiverRow;
}

/** The game ribbon a row makes by hand, as `riverTable` must make it: the quads in the raw frame, carried by the frame. */
function byHand(row: WaterRiverRow, toX: (x: number) => number, toZ: (z: number) => number): GameRibbon {
  const raw = row.points.map(([x, z, h]) => ({ x, z, h }));
  const { quads, runs } = ribbonQuads(raw, row.width);
  const r: TerrainRibbon = { version: 5, points: raw, width: row.width, shaderSize: 2, velocity: row.velocity, capWidth: 0, familyId: 0, featherFunction: 0, featherDistance: 0, shader: row.shader ?? '', waterType: 0, name: row.id, quads, runs, cap: null, capHeight: 0 };
  return gameRibbon(r, toX, toZ);
}

/** The walk of every water quad, by `ribbonAt`'s own arithmetic (no index): the highest surface over a point, or -Infinity. */
function walk(t: RiverTable, x: number, z: number): number {
  const s = t.river;
  let best = -Infinity;
  for (let i = 0; i < s.water.length; i++) {
    if (!s.water[i]) continue;
    const b = i * 4;
    if (x < s.quadBounds[b] || x > s.quadBounds[b + 1] || z < s.quadBounds[b + 2] || z > s.quadBounds[b + 3]) continue;
    const q = s.quads;
    const o = i * 12;
    const in1 = inTriangle(x, z, q[o], q[o + 2], q[o + 3], q[o + 5], q[o + 6], q[o + 8]);
    const in2 = !in1 && inTriangle(x, z, q[o], q[o + 2], q[o + 6], q[o + 8], q[o + 9], q[o + 11]);
    if (!in1 && !in2) continue;
    const v1 = in1 ? 3 : 9;
    const h = planeHeight(x, z, q[o], q[o + 1], q[o + 2], q[o + v1], q[o + v1 + 1], q[o + v1 + 2], q[o + 6], q[o + 7], q[o + 8]);
    if (Number.isFinite(h) && h > best) best = h;
  }
  return best;
}

// --- the row, read and written ---
{
  const a = river('the-run', [[0, 0, 5], [10, 0, 4.5], [20, 5, 4]], { name: 'The Run', fallFrom: 20, look: { color: '#2f6f8a', opacity: 0.7 }, at: 9 });
  const text = waterFileText('naboo', [a, { id: 'pond', kind: 'lake', h: 1, points: [[0, 0], [5, 0], [5, 5]], shader: null }] as never);
  const read = readWaterFile(text, 'naboo', 'ground');
  ok(read.problem === null && read.rows.length === 2 && read.skipped.length === 0, 'a file of a lake and a river reads back whole');
  const back = read.rows.find((r) => r.id === 'the-run');
  ok(!!back && back.kind === 'river' && sameWaterRow(back, a), 'the river as written: its spine to the bit, width, velocity, slope limit, shader, look, name and moment');
  ok(text.includes('{ "id": "pond", "kind": "lake", "h": 1, "shader": null, "points": [[0,0],[5,0],[5,5]] }'), "and the lake's line as a lake's always was");
  ok(typeof readWaterRow({ id: 'x', kind: 'river', points: [[0, 0, 1], [1, 0, 1]], width: 8, velocity: 1, fallFrom: 120 }) === 'string', 'a slope limit past the backstop is refused');
  const unknown: string[] = [];
  readWaterRow({ id: 'u', kind: 'river', points: [[0, 0, 1], [5, 0, 1]], width: 8, velocity: 1, foam: 2 }, unknown);
  ok(unknown.join() === 'u.foam', "a river's field this build does not read is named, never dropped silently");
}

// --- points merged ---
{
  const m = mergeClosePoints([[0, 0, 1], [2, 0, 1], [5, 0, 1], [6, 0, 1], [6.5, 0, 0]] as [number, number, number][], 4);
  ok(m.length === 2 && m[0][0] === 0 && m[1][0] === 6.5 && m[1][2] === 0, 'points nearer than the spacing are merged, the last kept where it was drawn (taking the place of the one before it)');
  ok(mergeClosePoints([[0, 0, 1], [1, 0, 1]] as [number, number, number][], 4).length === 2, 'a spine shorter than the spacing keeps its two ends');
}

// --- the strip: the client's quads, the slopes, the reaches ---
const flat = river('flat', [[0, 0, 2], [20, 0, 1.8], [40, 0, 1.6], [60, 20, 1.4], [80, 40, 1.2], [100, 40, 1]]);
{
  const toX = (x: number): number => 1000 - x;
  const toZ = (z: number): number => z - 300;
  const t = riverTable(flat, toX, toZ);
  const g = byHand(flat, toX, toZ);
  let same = t.river.quads.length === g.quads.length;
  for (let i = 0; same && i < g.quads.length; i++) if (!Object.is(t.river.quads[i], g.quads[i])) same = false;
  for (let i = 0; same && i < g.runs.length; i++) if (!Object.is(t.river.runs[i], g.runs[i])) same = false;
  ok(same && t.river.quads.length === 12 * (flat.points.length + 1), `its quads are the client's ribbon quads built in its raw frame and carried into the game's, to the bit (${t.river.quads.length / 12} for ${flat.points.length} points)`);
  ok(t.name === 'ours:flat' && t.ours === flat && !t.soe && t.shader === 'wter_spec' && t.waterType === 0 && t.cells === null && t.points.length === 0, "a table of the water readers' shape: named for its row, no outline, no lake index");
  // Each quad's slope is its two ends' (the middle quads between two points; the end pieces level).
  const q = t.river.quads;
  let slopes = true;
  for (let i = 0; i < t.river.slopes.length; i++) {
    const o = i * 12;
    const len = Math.hypot((q[o + 6] + q[o + 9]) / 2 - (q[o] + q[o + 3]) / 2, (q[o + 8] + q[o + 11]) / 2 - (q[o + 2] + q[o + 5]) / 2);
    const want = (Math.atan2(Math.abs(q[o + 7] - q[o + 1]), len) * 180) / Math.PI;
    if (Math.abs(t.river.slopes[i] - want) > 1e-12) slopes = false;
  }
  ok(slopes && t.river.slopes[0] === 0 && t.river.slopes[t.river.slopes.length - 1] === 0, 'each quad\'s slope is the rise between its two ends over their run (the two end pieces level)');
  ok(t.river.reaches.length === 3 && t.river.reaches[0].first === 0 && t.river.reaches[2].last === flat.points.length, `its reaches are the straight runs of its quads (${t.river.reaches.map((r) => `${r.first}-${r.last}`).join(', ')}): each a body of its own wind`);
  ok(t.river.stretches.length === 0 && t.river.water.every((w) => w === 1), 'a gentle river is water all its length, with no steep stretch');
}

// --- the bucket index answers as the walk; the surface is ribbonAt's ---
{
  const t = riverTable(flat, ident, ident);
  const g = byHand(flat, ident, ident);
  const hit: RiverHit = { h: 0, table: -1, quad: -1 };
  const out: RibbonPoint = { h: 0, fx: 0, fz: 0, type: 0 };
  let index = true;
  let rib = true;
  let found = 0;
  let s = 7;
  const rnd = (): number => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let k = 0; k < 100_000; k++) {
    const x = -10 + rnd() * 120;
    const z = -15 + rnd() * 70;
    const want = walk(t, x, z);
    const got = riverScan([t], x, z, -Infinity, hit) ? hit.h : -Infinity;
    if (!Object.is(got, want)) index = false;
    const r = ribbonAt([g], x, z, out) ? out.h : -Infinity;
    if (!Object.is(got, r)) rib = false;
    if (got > -Infinity) found++;
  }
  ok(index && found > 10_000, `the bucket index answers exactly as the walk of every water quad at 100,000 points (${found} over the river)`);
  ok(rib, "and the surface over a river is `ribbonAt`'s over the same quads, to the bit");
  // On a world with no converted terrain: the planet's level, the river higher than it where it stands.
  const planet = { id: 'river-test', seed: 3, palette: { low: 0x808080, mid: 0x808080, high: 0x808080, slope: 0x808080, shore: 0x808080 }, terrain: { base: 0, amplitude: 10, frequency: 0.01, octaves: 1, ridged: 0, flatten: 1, detail: 0 }, water: { level: 1.5 } } as unknown as PlanetDef;
  const terrain = new Terrain(planet);
  terrain.rivers.push(t);
  let world = true;
  for (let k = 0; k < 20_000; k++) {
    const x = -10 + rnd() * 120;
    const z = -15 + rnd() * 70;
    const r = ribbonAt([g], x, z, out) ? out.h : -Infinity;
    const want = r > 1.5 ? r : 1.5;
    if (!Object.is(terrain.waterHeightAt(x, z), want)) world = false;
  }
  ok(world, "a world with no converted terrain answers the higher of its level and the river's surface (`Terrain.waterHeightAt`)");
  const fl = { h: 0, fx: 0, fz: 0 };
  ok(riverFlowAt([t], 10, 0, fl) && Object.is(fl.fx, t.river.runs[2] * flat.velocity) && Object.is(fl.fz, t.river.runs[3] * flat.velocity), "its flow over a point is the quad's run times the river's velocity");
  ok(underRivers([t], 10, 0, 1.9 - LAKE_TUNE.floraUnder - 0.01) && !underRivers([t], 10, 0, 1.9 - LAKE_TUNE.floraUnder + 0.05) && !underRivers([t], 500, 0, -100), 'a planting more than the lakes\' own depth under a river is taken, and none off it');
}

// --- a converted world: the river after the lakes ---
{
  const dir = join(PACKS, 'rivertest');
  if (!existsSync(join(dir, 'terrain.trn')) || !existsSync(join(dir, 'layout.json'))) note('rivertest is not converted: SwgTerrain is not asked here');
  else {
    const layout = JSON.parse(readFileSync(join(dir, 'layout.json'), 'utf8')) as { center: { x: number; z: number } };
    const b = readFileSync(join(dir, 'terrain.trn'));
    const trn = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    const swg = await SwgTerrain.create(trn, [], layout.center.x, layout.center.z, async () => null);
    const plain = await SwgTerrain.create(trn, [], layout.center.x, layout.center.z, async () => null);
    const rows = soeRiverRows(swg.template.generator, RIVER_TUNE.spacingMin).rows.map((r) => readWaterRow(r) as WaterRiverRow);
    const tables = rows.map((r) => riverTable(r, (x) => swg.toGameX(x), (z) => swg.toGameZ(z), r.id));
    swg.setRivers(tables);
    const out: RibbonPoint = { h: 0, fx: 0, fz: 0, type: 0 };
    const gs = rows.map((r) => byHand(r, (x) => swg.toGameX(x), (z) => swg.toGameZ(z)));
    let same = true;
    let over = 0;
    let look = true;
    for (let k = 0; k < 4000; k++) {
      const x = ((k * 7919) % 900) - 450 + 0.37;
      const z = ((k * 104729) % 1700) - 600 - 0.61;
      const base = plain.waterAt(x, z);
      const r = ribbonAt(gs, x, z, out) ? out.h : -Infinity;
      const want = r > base ? r : base;
      const got = swg.waterAt(x, z);
      if (!Object.is(got, want)) same = false;
      if (r > base) {
        over++;
        const tb = swg.waterTableAt(x, z);
        if (!tb || tb.height !== got || coveringWaterShader(tb, false, got, 'global') !== 'wter_spec') look = false;
      }
    }
    ok(same && over > 100, `rivertest: SwgTerrain.waterAt is the higher of its lakes and sea and the terrain's own rivers' ribbonAt surface, to the bit (${over} of 4,000 points over a river)`);
    ok(look, "and over a river the camera's look names the river's own shader (its record carrying its surface there)");
    swg.setRivers([]);
    ok(swg.rivers === null, 'an empty list sets none (the lakes\' answers alone)');
    swg.dispose();
    plain.dispose();
  }
}

// --- the slope limit, and what a steep reach becomes ---
{
  // A 20-degree reach between the second and third points (14.56 m over 40 m).
  const steep = river('steep', [[0, 0, 30], [40, 0, 29], [80, 0, 14.441], [120, 0, 13.9]]);
  const at = (t: RiverTable): number => riversSurface([t], 60, 0, -Infinity);
  resetTune();
  const e = riverTable(steep, ident, ident);
  ok(e.river.stretches.length === 1 && e.river.stretches[0].first === 2 && Math.abs(e.river.stretches[0].slope - 20) < 0.01 && e.river.water.every((w) => w === 1) && at(e) > 14, `past ${RIVER_TUNE.slopeMax}° the reach is one steep stretch (${e.river.stretches[0]?.slope.toFixed(2)}°), and under 'effects' still water`);
  const fx = riverEffects(e);
  ok(fx.length >= 2 && fx[0].kind === 'spray' && fx[1].kind === 'mist' && Math.abs(fx[0].y - 14.441) < 1e-9 && fx.filter((f) => f.kind === 'spray').length >= 3, `the game's fall effects stand at its foot (a spray and a mist, small for a ${e.river.stretches[0].drop.toFixed(1)} m drop) and along its banks (${fx.length} in all)`);
  const drop = e.river.stretches[0].drop;
  ok(Math.abs(fx[0].scale - drop / RIVER_TUNE.smallRef) < 1e-12 && fx.every((f) => f.scale === fx[0].scale), `each scaled by its stretch's drop over the drop its file was made for (${fx[0].scale.toFixed(3)} = ${drop.toFixed(2)} / ${RIVER_TUNE.smallRef})`);
  ok(effectScaleOf(0.1, false) === RIVER_TUNE.scaleLeast && effectScaleOf(1e4, false) === RIVER_TUNE.scaleMost && effectScaleOf(2000, true) === RIVER_TUNE.scaleMost, 'held to its least and its most');
  RIVER_TUNE.effectScale = 2;
  ok(Math.abs(riverEffects(e)[0].scale - 2 * fx[0].scale) < 1e-12, 'and times the tune\'s own `effectScale`');
  RIVER_TUNE.effectScale = 1;
  RIVER_TUNE.bigDrop = 10;
  ok(riverEffects(e)[0].kind === 'sprayBig' && riverEffects(e)[1].kind === 'mistBig' && Math.abs(riverEffects(e)[0].scale - Math.max(RIVER_TUNE.scaleLeast, drop / RIVER_TUNE.bigRef)) < 1e-12 && riverEffects(e)[2].scale === fx[2].scale, "a drop past `bigDrop` stands the 200 m fall's spray and mist, scaled by its own reference (the banks' sprays the small fall's)");
  RIVER_TUNE.effectsMost = 3;
  ok(riverEffects(e).length === 3, 'and never more than `effectsMost`');
  resetTune();
  for (const mode of ['fall', 'refuse'] as const) {
    RIVER_TUNE.steep = mode;
    const c = riverTable(steep, ident, ident);
    ok(c.river.water[2] === 0 && at(c) === -Infinity && riversSurface([c], 20, 0, -Infinity) > 28 && riverEffects(c).length === 0 && c.river.reaches.length === 2, `under '${mode}' the steep reach is no water (none over its middle, the rest water, two reaches either side of it, no effects)`);
  }
  resetTune();
  const own = riverTable({ ...steep, fallFrom: 25 }, ident, ident);
  ok(own.river.stretches.length === 0 && own.river.limit === 25, "a river's own `fallFrom` wins over the tune");
  RIVER_TUNE.slopeMax = 21;
  ok(riverTable(steep, ident, ident).river.stretches.length === 0, 'and the tune moved past it takes the stretch away');
  resetTune();
}

// --- where the fall effects stand: the banks half the width off the spine, on the surface; every foot before any bank ---
{
  resetTune();
  // A 20-degree reach running neither along x nor along z (its way (0.6, 0.8)), so the banks' offset has both parts.
  const p0: [number, number, number] = [0, 0, 30];
  const p1: [number, number, number] = [24, 32, 29];
  const p2: [number, number, number] = [48, 64, 14.441];
  const diag = river('diag', [p0, p1, p2, [72, 96, 13.9]]);
  const t = riverTable(diag, ident, ident);
  const st = t.river.stretches[0];
  ok(t.river.stretches.length === 1 && st.first === 2 && st.last === 2, 'a slanted river with one steep stretch, its third quad');
  const fx = riverEffects(t);
  const half = diag.width / 2;
  const nx = 0.8;
  const nz = -0.6;
  let banks = true;
  const every = RIVER_TUNE.effectEvery;
  const pairs = Math.floor(40 / every);
  for (let k = 0; k < pairs; k++) {
    const d = every / 2 + k * every;
    const f = d / 40;
    const sx = p1[0] + (p2[0] - p1[0]) * f;
    const sz = p1[1] + (p2[1] - p1[1]) * f;
    const sy = p1[2] + (p2[2] - p1[2]) * f;
    const a = fx[2 + k * 2];
    const b = fx[3 + k * 2];
    if (!a || !b || a.kind !== 'spray' || b.kind !== 'spray') {
      banks = false;
      continue;
    }
    const near = (u: number, v: number): boolean => Math.abs(u - v) < 1e-9;
    if (!near(a.x, sx + nx * half) || !near(a.z, sz + nz * half) || !near(b.x, sx - nx * half) || !near(b.z, sz - nz * half)) banks = false;
    if (!near(a.y, sy) || !near(b.y, sy)) banks = false;
    if (!near(Math.hypot(a.x - sx, a.z - sz), half) || !near(Math.hypot(b.x - sx, b.z - sz), half)) banks = false;
  }
  ok(banks && fx.length === 2 + pairs * 2, `each bank's spray stands half the width (${half} m) off the spine, one either side, on the water's surface where it stands down the slope, the first half a step (${every / 2} m) in and one every ${every} m (${pairs} pairs)`);
  ok(fx[0].x === st.foot.x && fx[0].z === st.foot.z && fx[0].y === st.foot.y && Object.is(fx[0].yaw, Math.atan2(st.runX, st.runZ)), "the foot's spray at the stretch's foot, facing its way down");
  // Two steep stretches and a cap of six: both feet first, then the first pair of the first stretch's banks.
  const two = river('two', [[0, 0, 60], [40, 0, 59], [80, 0, 44.441], [120, 0, 44], [160, 0, 29.441], [200, 0, 29]]);
  const tt = riverTable(two, ident, ident);
  ok(tt.river.stretches.length === 2, 'a river with two steep stretches');
  RIVER_TUNE.effectsMost = 6;
  const six = riverEffects(tt);
  const footOf = (e: RiverEffect, i: number): boolean => e.x === tt.river.stretches[i].foot.x && e.z === tt.river.stretches[i].foot.z;
  ok(six.length === 6 && six[0].kind === 'spray' && six[1].kind === 'mist' && footOf(six[0], 0) && footOf(six[2], 1) && six[3].kind === 'mist' && footOf(six[3], 1) && six[4].x > 40 && six[4].x < 80 && six[5].x > 40 && six[5].x < 80, "under a cap of six every stretch's foot stands before any bank's spray, then the first stretch's first pair");
  RIVER_TUNE.effectsMost = 8;
  const eight = riverEffects(tt);
  ok(eight.length === 8 && eight[6].x > 120 && eight[6].x < 160 && eight[7].x > 120 && eight[7].x < 160, 'and the next pair is the second stretch\'s first, the banks going a pair of each stretch in turn');
  RIVER_TUNE.effectsMost = 3;
  ok(riverEffects(tt).length === 3 && footOf(riverEffects(tt)[2], 1), 'a cap of three: the first foot whole and the second foot\'s spray');
  resetTune();
}

// --- the effects' sync: one set standing, however the syncs overlap ---
{
  resetTune();
  const t = riverTable(river('steepish', [[0, 0, 30], [40, 0, 29], [80, 0, 14.441], [120, 0, 13.9]]), ident, ident);
  const want = riverEffects(t).length;
  const files = { spray: 'spray.json', mist: 'mist.json', sprayBig: 'sprayBig.json', mistBig: 'mistBig.json' };
  const live = new Set<number>();
  let next = 1;
  let still = true;
  const host: RiverFxHost<number> = {
    // A file made ready a turn of the clock later, so a sync begun meanwhile overlaps it.
    prepare: () => new Promise<boolean>((res) => setTimeout(() => res(true), 2)),
    place: () => {
      const h = next++;
      live.add(h);
      return h;
    },
    remove: (h) => {
      live.delete(h);
    },
    still: () => still,
  };
  const keeper = new RiverEffectsKeeper<number>();
  const a = keeper.sync([t], files, host);
  const b = keeper.sync([t], files, host);
  const [ra, rb] = await Promise.all([a, b]);
  ok(ra === null && rb?.placed === want && live.size === want && keeper.count === want, `two syncs that overlap (a slider dragged while a file is fetched) leave one set standing (${live.size} of ${want}); the one overtaken stands nothing`);
  const c = await keeper.sync([t], files, host);
  ok(c?.placed === want && live.size === want && keeper.count === want, 'a sync after one is done takes its effects away and stands them again');
  const d = keeper.sync([t], files, host);
  still = false;
  ok((await d) === null && live.size === 0 && keeper.count === 0, 'one whose world goes while it waits has taken the last set away and stands none');
  still = true;
  const e = keeper.sync([t], files, host);
  keeper.forget();
  ok((await e) === null && live.size === 0 && keeper.count === 0, 'and one the world forgets while it waits (its going) stands none');
  const f = await keeper.sync([], files, host);
  ok(f === null && live.size === 0, 'with no river, nothing');
}

// --- the landing's difference and the retune's ---
{
  resetTune();
  const A = river('a', [[0, 0, 2], [20, 0, 1.8], [40, 0, 1.6]]);
  const A2 = river('a', [[0, 10, 2], [20, 10, 1.8], [40, 10, 1.6]]);
  const B = river('b', [[0, 50, 2], [20, 50, 1.8]]);
  const tA = riverTable(A, ident, ident);
  const tA2 = riverTable(A2, ident, ident);
  const tB = riverTable(B, ident, ident);
  const moved = new Set(['a']);
  let p = riverLandingPlan([tA, tB], [tB], moved);
  ok(p.drop.join() === 'ours:a' && p.add.length === 0 && p.touched.length === 1 && p.touched[0] === tA, 'a river taken out (Delete, or the undo of its writing) loses its bodies, and what stood under it is made again');
  p = riverLandingPlan([tA, tB], [tA2, tB], moved);
  ok(p.drop.join() === 'ours:a' && p.add.length === 1 && p.add[0] === tA2 && p.touched.includes(tA) && p.touched.includes(tA2) && !p.touched.includes(tB), 'a river moved is taken down and stood again where it is, under its old place and its new');
  p = riverLandingPlan([tB], [tA, tB], moved);
  ok(p.add.length === 1 && p.add[0] === tA && p.touched.length === 1 && !p.drop.includes('ours:b'), 'a river put (written, or the undo of its removal) is stood, and one that did not move is left alone');
  const soe = riverTable(A, ident, ident, 'a');
  p = riverLandingPlan([soe], [soe], moved);
  ok(p.drop.length === 0 && p.add.length === 0, "and the terrain's own rivers are never a landing's");
  // The retune's: under 'effects' a slope limit moved keeps every body (the same water); under 'fall' only the river
  // whose steep reach is cut out is stood again.
  const S = river('s', [[0, 0, 30], [40, 0, 29], [80, 0, 14.441], [120, 0, 13.9]]);
  const before = [riverTable(S, ident, ident), tA, tB];
  RIVER_TUNE.slopeMax = 25;
  let after = [riverTable(S, ident, ident), riverTable(A, ident, ident), riverTable(B, ident, ident)];
  let r = riverRetunePlan(before, after);
  ok(r.keep.length === 3 && r.drop.length === 0 && r.add.length === 0 && r.touched.length === 0 && r.keep[0].to === after[0] && r.keep[0].from === before[0], "under 'effects' the slope slider keeps every river's bodies (handed its new table) and makes nothing under them again");
  RIVER_TUNE.slopeMax = 12;
  RIVER_TUNE.steep = 'fall';
  after = [riverTable(S, ident, ident), riverTable(A, ident, ident), riverTable(B, ident, ident)];
  r = riverRetunePlan(before, after);
  ok(r.keep.length === 2 && r.drop.join() === 'ours:s' && r.add.length === 1 && r.add[0] === after[0] && r.touched.includes(before[0]) && r.touched.includes(after[0]) && r.touched.length === 2, "under 'fall' the river whose steep reach is cut out is taken down and stood again, the others kept");
  resetTune();
  r = riverRetunePlan(before, [riverTable(A, ident, ident), riverTable(A2, ident, ident, 'n')]);
  ok(r.drop.includes('ours:s') && r.drop.includes('ours:b') && r.add.some((x) => x.name === 'soe:n') && r.keep.length === 1, 'a river gone is taken down and one come is stood');
  resetTune();
}

// --- the tune's routing: what each number asks of the rivers standing, and its clamps ---
{
  resetTune();
  const calls: RiverRetune[] = [];
  const run = (tune: Record<string, unknown>): { calls: string; said: string[] } => {
    calls.length = 0;
    const said = tuneRiverTune(tune, (what) => calls.push(what));
    return { calls: calls.join(), said };
  };
  ok(run({ flow: 2 }).calls === 'flow', '`flow` alone rewrites the winds');
  const effectKeys = ['effectEvery', 'bigDrop', 'effectsMost', 'effectScale', 'smallRef', 'bigRef', 'scaleLeast', 'scaleMost'] as const;
  let effects = true;
  for (const k of effectKeys) if (run({ [k]: (RIVER_TUNE[k] as number) + 1 }).calls !== 'effects') effects = false;
  ok(effects, "each of the effects' own numbers stands the effects again and makes no table or body");
  ok(run({ slopeMax: 15 }).calls === 'shape' && run({ steep: 'fall' }).calls === 'shape' && run({ steep: 'effects' }).calls === 'shape' && run({ bucket: 8 }).calls === 'shape', 'the slope limit, what a steep reach is and the index\'s cell make the tables again');
  ok(run({ spacingMin: 6 }).calls === '' && run({ slopeMax: 15 }).calls === '' && run({ riverWidth: 12 }).calls === '', 'the spacing, a number not moved and the tool\'s own numbers ask nothing now');
  ok(run({ slopeMax: 20, flow: 3 }).calls === 'shape,flow' && run({ effectScale: 2.5, flow: 4 }).calls === 'effects,flow', 'a shape or an effects number moved with the flow asks both (a river kept by a shape keeps its winds)');
  ok(run({ nonsense: 1 }).said.length === 1 && run({ steep: 'sideways' }).said.length === 1 && run({ slopeMax: 'x' }).said.length === 1, 'anything else is said');
  run({ slopeMax: 120 });
  const high = RIVER_TUNE.slopeMax;
  run({ slopeMax: -5 });
  const low = RIVER_TUNE.slopeMax;
  run({ effectsMost: 7.6, effectEvery: 0.1, bucket: 0.1, effectScale: 0, smallRef: 0, bigRef: 0, scaleLeast: 0, spacingMin: -1, bigDrop: -3 });
  ok(high === 89 && low === 0 && RIVER_TUNE.effectsMost === 8 && RIVER_TUNE.effectEvery === 0.5 && RIVER_TUNE.bucket === 0.5 && RIVER_TUNE.effectScale === 0.01 && RIVER_TUNE.smallRef === 0.1 && RIVER_TUNE.bigRef === 0.1 && RIVER_TUNE.scaleLeast === 0.01 && RIVER_TUNE.spacingMin === 0 && RIVER_TUNE.bigDrop === 0, 'each number held to sense (the slope limit 0 to 89, the cap whole, the spacing and steps above nought)');
  run({ scaleLeast: 2, scaleMost: 1 });
  ok(RIVER_TUNE.scaleMost === 2, 'and the most scale never under the least');
  resetTune();
}

// --- the camera's look over a river, and a lake standing higher ---
{
  const t = riverTable(flat, ident, ident);
  const lakeHigh = { name: 'lake', points: [{ x: 0, z: -5 }, { x: 15, z: -5 }, { x: 15, z: 5 }, { x: 0, z: 5 }], height: 3, shader: 'wter_lake', waterType: 0, shaderSize: 2, minX: 0, maxX: 15, minZ: -5, maxZ: 5 };
  const over = riverTableAt([t], 30, 0, null) as RiverTable | null;
  ok(!!over && over === t && Object.is(over.height, riversSurface([t], 30, 0, -Infinity)) && coveringWaterShader(over, false, over.height, 'global') === 'wter_spec', "over a river `waterTableAt`'s record is the river's, its height its surface there, and the look its shader");
  ok(riverTableAt([t], 10, 0, lakeHigh) === lakeHigh, 'a lake standing higher keeps the point');
  const level = riverTable(river('level', [[0, 0, 2], [40, 0, 2], [80, 0, 2]]), ident, ident);
  const tie = { ...lakeHigh, height: 2 };
  ok(riverTableAt([level], 20, 0, tie) === tie && riverTableAt([level], 20, 0, { ...lakeHigh, height: 1.999 }) === level, 'and one at the very surface of the river there keeps it too (the earliest on a tie), where a hair lower gives it up');
  ok(riverTableAt([t], 500, 0, null) === null, 'and off every river nothing new');
}

// --- a reach's own wind, the lake's program ---
{
  const SRC = join(REPO, 'src');
  register(pathToFileURL(join(REPO, 'tools', 'swg', 'tests', 'airLoader.mjs')).href, import.meta.url, { data: { roots: [SRC], packageBase: join(REPO, 'package.json') } });
  const THREE = (await import('three')) as typeof import('three');
  const W = (await import(pathToFileURL(join(SRC, 'world', 'water.ts')).href)) as typeof import('../../../src/world/water.ts');
  const WB = (await import(pathToFileURL(join(SRC, 'world', 'waterBodies.ts')).href)) as typeof import('../../../src/world/waterBodies.ts');
  const L = (await import(pathToFileURL(join(SRC, 'world', 'volumetrics', 'airLiquid.ts')).href)) as typeof import('../../../src/world/volumetrics/airLiquid.ts');
  const text = readFileSync(join(SRC, 'world', 'water.ts'), 'utf8');
  const DETAIL_FLOW = Number(/const DETAIL_FLOW = ([\d.]+);/.exec(text)?.[1]);
  const DETAIL_CYCLE = Number(/const DETAIL_CYCLE = ([\d.]+);/.exec(text)?.[1]);
  const look = { color: '#336677', opacity: 0.8, ripple: 1, drift: 1.4, source: 'planet' as const };
  const wind = { value: new THREE.Vector2() };
  const lake = W.createWaterMaterial(look as never, false);
  const reach = W.createWaterMaterial(look as never, false, { wind });
  ok(reach.userData.uniforms.uWind === wind && lake.userData.uniforms.uWind === W.WATER_WIND, "a reach's material holds its own wind object; a lake's the weather's shared one");
  ok(reach.customProgramCacheKey() === lake.customProgramCacheKey(), `and its program's key is the lake's (${lake.customProgramCacheKey()}): no program of its own`);
  const bodies = new WB.WaterBodies();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 4));
  const body = bodies.add(mesh, false, look as never, 'lake', wind);
  bodies.makeAir();
  ok(body.lit.userData.uniforms.uWind === wind && body.masks.every((m) => m.userData.uniforms.uWind === wind) && body.air?.userData.uniforms.uWind === wind, 'a body made with it: its lit material, both mask twins and its current variant all hold that one object');
  const plain = bodies.add(new THREE.Mesh(new THREE.PlaneGeometry(4, 4)), false, look as never, 'lake');
  ok(plain.lit.userData.uniforms.uWind === W.WATER_WIND, "a body made with none keeps the weather's");
  // The wind written for a reach carries the detail downstream at the river's own speed (detailSlope's units).
  const t = riverTable(flat, ident, ident);
  const r = t.river.reaches[1];
  reachWind(r, t.river.velocity, W.riverWindUnit(look.drift), RIVER_TUNE.flow, wind.value);
  const speed = (v: number): number => (L.detailCarried(v, look.drift, DETAIL_FLOW, DETAIL_CYCLE, 2.001) - L.detailCarried(v, look.drift, DETAIL_FLOW, DETAIL_CYCLE, 2)) / 0.001;
  ok(Math.abs(speed(wind.value.x) - r.runX * flat.velocity) < 1e-6 && Math.abs(speed(wind.value.y) - r.runZ * flat.velocity) < 1e-6, `and the reach's detail drifts downstream at the river's own ${flat.velocity} m/s (${speed(wind.value.x).toFixed(4)}, ${speed(wind.value.y).toFixed(4)})`);
  const W2 = W.riverWindUnit(2);
  ok(Math.abs(W2 - 2 * DETAIL_FLOW * DETAIL_CYCLE) < 1e-15, "`riverWindUnit` is detailSlope's own: drift times its two constants");
  bodies.clear?.();
}

// --- the terrain's own wet rivers ---
{
  let read = 0;
  for (const [w, want] of [['rivertest', 2], ['watertabletest', 1]] as const) {
    const file = join(PACKS, w, 'terrain.trn');
    if (!existsSync(file)) {
      note(`${w} is not converted: its rivers are not read here`);
      continue;
    }
    const tmpl = parseTerrainTemplate(new Uint8Array(readFileSync(file)));
    const got = soeRiverRows(tmpl.generator, RIVER_TUNE.spacingMin);
    ok(got.rows.length === want && got.skipped.length === 0, `${w}: ${want} wet river${want === 1 ? '' : 's'} that run${want === 1 ? 's' : ''}, read as rows of the water file's river shape`);
    // Each row from its affector: the samples less the depth, the table's own width, the affector's velocity and shader.
    const rivers: AffectorRiver[] = [];
    // The layers each river stands under, outermost first (a river is read only where every one of them is switched on).
    const chains: Layer[][] = [];
    const walkLayers = (ls: typeof tmpl.generator.layers, above: Layer[]): void => {
      for (const l of ls) {
        if (!l.active) continue;
        for (const a of l.affectors) {
          if (a.active && a instanceof AffectorRiver && a.hasLocalWaterTable) {
            rivers.push(a);
            chains.push([...above, l]);
          }
        }
        walkLayers(l.layers, [...above, l]);
      }
    };
    walkLayers(tmpl.generator.layers, []);
    // Under the default tune every steep stretch stands at least its foot (the cap is reached on the banks, never before a foot).
    {
      let feet = true;
      let stretches = 0;
      for (const raw of got.rows) {
        const row = readWaterRow(raw);
        if (typeof row === 'string' || row.kind !== 'river') continue;
        const t = riverTable(row, ident, ident, row.id);
        const fx = riverEffects(t);
        stretches += t.river.stretches.length;
        if (t.river.stretches.length * 2 > RIVER_TUNE.effectsMost) continue;
        for (const st of t.river.stretches) if (!fx.some((e) => (e.kind === 'spray' || e.kind === 'sprayBig') && e.x === st.foot.x && e.z === st.foot.z && e.y === st.foot.y)) feet = false;
      }
      ok(feet, `${w}: under the default tune each of its ${stretches} steep stretches stands its foot's spray (a cap of ${RIVER_TUNE.effectsMost} is only ever reached on the banks)`);
    }
    let shape = true;
    got.rows.forEach((raw, i) => {
      const row = readWaterRow(raw);
      const a = rivers[i];
      if (typeof row === 'string' || row.kind !== 'river' || !a) {
        shape = false;
        return;
      }
      const first = a.heightData.segments[0][0];
      if (row.points[0][0] !== first.x || row.points[0][1] !== first.z || row.points[0][2] !== first.y - a.localWaterTableDepth) shape = false;
      if (row.width !== a.localWaterTableWidth || row.velocity !== a.velocity || !row.shader) shape = false;
      for (let k = 1; k < row.points.length; k++) if (Math.hypot(row.points[k][0] - row.points[k - 1][0], row.points[k][1] - row.points[k - 1][1]) < RIVER_TUNE.spacingMin && k !== row.points.length - 1) shape = false;
    });
    ok(shape, `${w}: each through the file's own reader, its first point the first sample at its height less the water's depth, its width the table's, its velocity and shader the affector's, no two points nearer than the spacing`);
    if (w === 'rivertest') {
      // A river of lava is left out and said; a river switched off, or under a layer switched off, is not read at all.
      rivers[0].waterType = 1;
      const lava = soeRiverRows(tmpl.generator, RIVER_TUNE.spacingMin);
      rivers[0].waterType = 0;
      ok(lava.rows.length === 1 && lava.skipped.length === 1 && /lava/.test(lava.skipped[0].why), `a river of lava is left out and said ("${lava.skipped[0]?.why}")`);
      rivers[1].active = false;
      const off = soeRiverRows(tmpl.generator, RIVER_TUNE.spacingMin);
      rivers[1].active = true;
      ok(off.rows.length === 1 && off.skipped.length === 0, 'and a river switched off is not read');
      // The layer it stands in switched off, the river itself left on: none of the rivers under that layer is read.
      const layer = chains[1][chains[1].length - 1];
      const under = chains.filter((c) => c.includes(layer)).length;
      layer.active = false;
      const layerOff = soeRiverRows(tmpl.generator, RIVER_TUNE.spacingMin);
      layer.active = true;
      ok(rivers[1].active && under >= 1 && layerOff.rows.length === rivers.length - under && layerOff.skipped.length === 0, `and a river whose layer is switched off is not read though the river itself is on (${layerOff.rows.length} of ${rivers.length} read)`);
      // Its width is the water table's (`localWaterTableWidth`), never the trench's (`width`): on the test rivers the two
      // are equal, so the table's is moved here to tell them apart.
      const was = rivers[0].localWaterTableWidth;
      rivers[0].localWaterTableWidth = rivers[0].width + 7;
      const wide = readWaterRow(soeRiverRows(tmpl.generator, RIVER_TUNE.spacingMin).rows[0]);
      rivers[0].localWaterTableWidth = was;
      ok(typeof wide !== 'string' && wide.kind === 'river' && wide.width === rivers[0].width + 7 && wide.width !== rivers[0].width, `its width is the water table's own (${typeof wide === 'string' ? wide : wide.width} m where the trench is ${rivers[0].width} m)`);
    }
    read++;
  }
  if (!read) note('no test world with rivers is converted');
}

console.log(`rivers: ${checks} checks passed`);
