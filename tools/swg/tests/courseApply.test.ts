// The race drawer's second wave: the carve laid where a grid enters a cache, on the real `SwgTerrain` and `Terrain` in node
// (the main-thread path: no worker here). A converted world with a figure eight and a heights file round it: every pole of
// every cached block is `fround(fround(carve(raw)) + d)`; both copies of every edge pole agree; `basePoleAt` is the carve
// from raw; a course changed and laid again over its dirty rectangles alone, a budget at a time, is a ground made afresh
// with it, and the change undone is the ground before to the bit; a store handed over after the ground was made (a file
// landed while it was being made, or late) by the world's own steps is the ground made with it, and every course taken out
// the heights' ground alone; the generator's grid and a building layer's base never read the carve. A far grid's samples are the carve of their raw heights with the far widening (a sample within
// half a far step of a road takes its surface), and only there do they differ from the block poles under them. And on
// Monument (its committed raster) the pole grid is the carve at every pole and `heightAt` is carved, then edited.
//
// Run: node tools/swg/tests/courseApply.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SwgTerrain } from '../../../src/world/swgTerrain.ts';
import { Terrain } from '../../../src/world/terrain.ts';
import { HeightEdits, HEIGHT_TILE_POLES } from '../../../src/swg/terrain/heightEdits.ts';
import { TerrainSampler } from '../../../src/swg/terrain/trn.ts';
import { CourseCarve, CourseGrid, carveAsk, type CarveTrack } from '../../../src/swg/terrain/courseCarve.ts';
import { makeDemPatch } from '../../../src/world/demTerrain.ts';
import { groundChunkOrigin } from '../../../src/world/groundTiles.ts';
import { PLANETS } from '../../../src/data/planets.ts';
import { figureEight, straight } from './carveFixtures.ts';
import { groundWorlds, PACKS } from './terrainHarness.ts';
import { REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);

function centreOf(world: string): { x: number; z: number } | null {
  const file = join(PACKS, world, 'layout.json');
  if (!existsSync(file)) return null;
  const m = /"center"\s*:\s*\{\s*"x"\s*:\s*(-?[\d.]+)\s*,\s*"z"\s*:\s*(-?[\d.]+)/.exec(readFileSync(file, 'utf8').slice(0, 8000));
  return m ? { x: Number(m[1]), z: Number(m[2]) } : null;
}
const storeOf = (ts: CarveTrack[]): CourseCarve => {
  const s = new CourseCarve();
  s.set(ts);
  return s;
};
/** One sample of the carve with a widening (a far grid's): a lay of one pole. */
function carveWiden(s: CourseCarve, raw: number, x: number, z: number, widen: number): number {
  const a = carveAsk();
  a.raw = new Float32Array([raw]);
  a.out = new Float32Array(1);
  a.x0 = x;
  a.dx = 2;
  a.z0 = z;
  a.dz = 2;
  a.nx = 1;
  a.nz = 1;
  a.widen = widen;
  s.layIn(a);
  return a.out[0];
}
/** The figure eight moved: one node of its upper diagonal. */
function eightMoved(): CarveTrack {
  const t = figureEight('eight', 8);
  t.course!.paths[0].nodes[2] = { ...t.course!.paths[0].nodes[2], x: 104, z: -78, y: 9 };
  return t;
}

const all = groundWorlds();
const worlds = ['dantooine', 'tatooine', 'naboo'].filter((w) => all.includes(w)).slice(0, 2);
if (!worlds.length && all.length) worlds.push(all[0]);
if (!worlds.length) note(`no converted worlds under ${PACKS}: the converted half is skipped`);

for (const world of worlds) {
  const c = centreOf(world);
  if (!c) continue;
  const dir = join(PACKS, world);
  const bytes = (rel: string): ArrayBuffer | null => {
    const f = join(dir, rel);
    if (!existsSync(f)) return null;
    const b = readFileSync(f);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  const trn = bytes('terrain.trn');
  if (!trn) continue;
  const fetchBytes = async (f: string) => bytes(f);
  // A heights file round the course: a bump over the crossing's tiles and a dip beside it.
  const heights = new HeightEdits();
  for (let tz = -2; tz <= 1; tz++)
    for (let tx = -2; tx <= 1; tx++) {
      const d = heights.writable(tx, tz)!;
      for (let k = 0; k < d.length; k++) d[k] = Math.fround(Math.sin((k % HEIGHT_TILE_POLES) * 0.3 + tx) * 1.5 + (tz === 0 ? -0.75 : 0));
    }
  const course = storeOf([figureEight('eight', 8)]);
  const sw = await SwgTerrain.create(trn, [], c.x, c.z, fetchBytes, { heights, course });
  const s = sw.sampler;
  const rawS = new TerrainSampler(sw.template);
  const np = s.numberOfPoles;
  const step = s.poleStep;
  const bw = s.blockWidth;
  const start = (b: number) => b * bw - 2 * step;
  const B0 = -4;
  const B1 = 3;
  const cache = () => {
    for (let bz = B0; bz <= B1; bz++) for (let bx = B0; bx <= B1; bx++) s.generateBlock(bx, bz);
  };
  cache();
  // 1. Every pole: the carve from raw, the heights over it.
  let bad = '';
  let carved = 0;
  const seen = new Map<string, number>();
  let edgeBad = '';
  const first = new Map<string, Float32Array>();
  for (let bz = B0; bz <= B1; bz++)
    for (let bx = B0; bx <= B1; bx++) {
      const b = s.generateBlock(bx, bz);
      first.set(`${bx},${bz}`, b.heights.slice());
      const raw = rawS.generateBlock(bx, bz);
      for (let j = 0; j < np; j++)
        for (let i = 0; i < np; i++) {
          const k = j * np + i;
          const x = start(bx) + i * step;
          const z = start(bz) + j * step;
          const cv = Math.fround(course.carveAt(raw.heights[k], x, z));
          if (cv !== raw.heights[k]) carved++;
          const d = heights.poleDelta(x / 2, z / 2);
          const want = d !== 0 ? Math.fround(cv + d) : cv;
          if (!Object.is(b.heights[k], want)) bad ||= `block ${bx},${bz} pole ${i},${j}: ${b.heights[k]} against ${want}`;
          const key = `${x},${z}`;
          const was = seen.get(key);
          if (was === undefined) seen.set(key, b.heights[k]);
          else if (!Object.is(was, b.heights[k])) edgeBad ||= key;
        }
    }
  ok(!bad && carved > 1000, `${world}: every pole of 64 cached blocks is fround(fround(carve(raw)) + d), ${carved} of them carved${bad ? ` (${bad})` : ''}`);
  ok(!edgeBad, `${world}: both copies of every edge pole agree${edgeBad ? ` (apart at ${edgeBad})` : ''}`);
  let baseBad = '';
  for (let k = 0; k < 400; k++) {
    const x = (((k * 37) % 160) - 80) * 2;
    const z = (((k * 59) % 160) - 80) * 2;
    const r = rawS.generateBlock(Math.floor(x / bw), Math.floor(z / bw));
    const bxs = start(Math.floor(x / bw));
    const bzs = start(Math.floor(z / bw));
    const raw = r.heights[((z - bzs) / step) * np + (x - bxs) / step];
    if (!Object.is(s.basePoleAt(x, z), Math.fround(course.carveAt(raw, x, z)))) baseBad ||= `${x},${z}`;
  }
  ok(!baseBad, `${world}: basePoleAt is the carve worked out from the raw copy at 400 poles, never the laid heights less the edit${baseBad ? ` (apart at ${baseBad})` : ''}`);

  // 2. A change laid again over its dirty rectangles alone, a budget at a time, against a ground made afresh with it.
  const n = course.set([eightMoved()]);
  sw.courseLater(course.rects, n);
  let frames = 0;
  let clock = 0;
  const now = () => (clock += 0.4);
  while (sw.courseWaiting.blocks + sw.courseWaiting.far > 0 && frames < 10000) {
    sw.stepCourse(2, Number.NaN, Number.NaN, now, () => {});
    frames++;
  }
  const fresh = await SwgTerrain.create(trn, [], c.x, c.z, fetchBytes, { heights, course: storeOf([eightMoved()]) });
  let changeBad = '';
  for (let bz = B0; bz <= B1; bz++)
    for (let bx = B0; bx <= B1; bx++) {
      const a = s.generateBlock(bx, bz).heights;
      const b = fresh.sampler.generateBlock(bx, bz).heights;
      if (!a.every((v, i) => Object.is(v, b[i]))) changeBad ||= `${bx},${bz}`;
    }
  ok(!changeBad && frames > 1, `${world}: a node moved, laid again over its ${n} dirty rectangles at a 2 ms budget over ${frames} frames, is the ground made afresh with it${changeBad ? ` (apart at block ${changeBad})` : ''}`);
  // 3. Undone: every block back to its bits.
  const m = course.set([figureEight('eight', 8)]);
  sw.courseLater(course.rects, m);
  sw.stepCourse(Infinity, Number.NaN, Number.NaN, () => 0, () => {});
  let undoBad = '';
  for (const [key, h] of first) {
    const [bx, bz] = key.split(',').map(Number);
    const a = s.generateBlock(bx, bz).heights;
    if (!a.every((v, i) => Object.is(v, h[i]))) undoBad ||= key;
  }
  ok(!undoBad, `${world}: the change undone returns every block to its bits${undoBad ? ` (apart at ${undoBad})` : ''}`);
  // 4. A store put in after the ground was made (a course file that landed while the converted ground was being made, kept
  // for it, or one the bound gave up on): the very hand-over the world makes (`World.attachCourse`'s converted branch, then
  // `queueCourseRects`): handed to the sampler, every edge's rectangle queued, laid a budget at a time. The ground made with it.
  const late = await SwgTerrain.create(trn, [], c.x, c.z, fetchBytes, { heights });
  for (let bz = B0; bz <= B1; bz++) for (let bx = B0; bx <= B1; bx++) late.sampler.generateBlock(bx, bz);
  const lateStore = storeOf([figureEight('eight', 8)]);
  late.sampler.course = lateStore;
  lateStore.allRects();
  late.courseLater(lateStore.rects, lateStore.rectN);
  let lateFrames = 0;
  while (late.courseWaitingCount > 0 && lateFrames < 10000) {
    late.stepCourse(2, Number.NaN, Number.NaN, now, () => {});
    lateFrames++;
  }
  let lateBad = '';
  for (const [key, h] of first) {
    const [bx, bz] = key.split(',').map(Number);
    if (!late.sampler.generateBlock(bx, bz).heights.every((v, i) => Object.is(v, h[i]))) lateBad ||= key;
  }
  ok(!lateBad && lateFrames > 1, `${world}: a store handed over after the ground was made (the world's own steps: the sampler, every edge queued, ${lateFrames} frames at a 2 ms budget) is the ground made with it${lateBad ? ` (apart at ${lateBad})` : ''}`);
  // Every course taken out (the world's `landCourses([])`): its edges queued and laid again, the heights' ground alone.
  const out = lateStore.set([]);
  late.courseLater(lateStore.rects, out);
  late.stepCourse(Infinity, Number.NaN, Number.NaN, () => 0, () => {});
  const bare = await SwgTerrain.create(trn, [], c.x, c.z, fetchBytes, { heights });
  let freeBad = '';
  for (let bz = B0; bz <= B1; bz++)
    for (let bx = B0; bx <= B1; bx++) {
      const a = late.sampler.generateBlock(bx, bz).heights;
      const ref = bare.sampler.generateBlock(bx, bz).heights;
      if (!a.every((v, i) => Object.is(v, ref[i]))) freeBad ||= `${bx},${bz}`;
    }
  ok(!freeBad && late.courseWaitingCount === 0, `${world}: and every course taken out, the ground is the heights' alone again${freeBad ? ` (apart at ${freeBad})` : ''}`);
  // 4a. The land under a point with no course carved (`SwgTerrain.landAt`, the Course tool's land and, `cachedOnly`, its
  // notes'): a point in the last pole of a cached block reads its next pole in the block beside, which the notes never make.
  {
    const lone = await SwgTerrain.create(trn, [], c.x, c.z, fetchBytes, { heights });
    lone.sampler.generateBlock(0, 0);
    const rx = bw - 1;
    const rz = 10.5;
    const gx = lone.toGameX(rx);
    const gz = lone.toGameZ(rz);
    const before = lone.sampler.hasBlock(1, 0);
    const known = lone.landAt(gx, gz, heights, true);
    const after = lone.sampler.hasBlock(1, 0);
    const made = lone.landAt(gx, gz, heights, false);
    const inside = lone.landAt(lone.toGameX(bw / 2 + 0.5), gz, heights, true);
    ok(!before && Number.isNaN(known) && !after && Number.isFinite(made) && lone.sampler.hasBlock(1, 0) && Number.isFinite(inside), `${world}: the notes' land at a point within a pole of a cached block's far edge is unknown and makes no block (the block beside stays uncached), where the editor's own land makes it and a point inside reads its own block`);
  }
  // 4b. Where the carve never reaches (§4's read sites): the generator's own grid (`generate`) and a building layer's base
  // (`baseHeightAt`, what `addBuildingLayer` flattens to) are the raw ground's with a course on the sampler, bit for bit.
  {
    const bareS = new TerrainSampler(sw.template);
    let rawBad = '';
    for (let k = 0; k < 300; k++) {
      const x = (((k * 37) % 160) - 80) * 2 + 0.7;
      const z = (((k * 59) % 160) - 80) * 2 - 1.3;
      if (!Object.is(s.baseHeightAt(x, z), bareS.baseHeightAt(x, z))) rawBad ||= `base ${x},${z}`;
    }
    const g1 = s.generate(-40, -40, 33, 2);
    const g2 = bareS.generate(-40, -40, 33, 2);
    if (!g1.heights.every((v, i) => Object.is(v, g2.heights[i]))) rawBad ||= 'generate';
    ok(!rawBad && s.course === course, `${world}: with the course on the sampler, a building layer's base (baseHeightAt, 300 points about the crossing) and the generator's own grid are the raw ground's to the bit${rawBad ? ` (apart: ${rawBad})` : ''}`);
  }

  // 5. A far grid: its samples the carve of their raw heights with the far widening, the block's pole elsewhere.
  const far = await SwgTerrain.create(trn, [], c.x, c.z, fetchBytes, { course: storeOf([straight('w', -400, 400, 3, 6, { w: 10, sh: 4 }), figureEight('eight', 8)]) });
  const plain = storeOf([straight('w', -400, 400, 3, 6, { w: 10, sh: 4 }), figureEight('eight', 8)]);
  let farBad = '';
  let widened = 0;
  let samples = 0;
  // The far tiles round the raw frame's origin (the course's), in the game's frame.
  const tx0 = Math.floor(far.toGameX(0) / 512);
  const tz0 = Math.floor(far.toGameZ(0) / 512);
  for (const [tx, tz] of [
    [tx0, tz0],
    [tx0 - 1, tz0],
    [tx0, tz0 - 1],
    [tx0 - 1, tz0 - 1],
  ]) {
    const o = groundChunkOrigin(tx, tz, far.groundShift, 512);
    const g = far.farGrid(o.x, o.z, 512, 32, true);
    const meta = (far as unknown as { farMeta: WeakMap<object, { x0: number; dx: number; z0: number; step: number; n: number; raw: Float32Array | null }> }).farMeta.get(g!);
    if (!g || !meta) continue;
    for (let j = 0; j < meta.n; j++)
      for (let i = 0; i < meta.n; i++) {
        const k = j * meta.n + i;
        const x = meta.x0 + i * meta.dx;
        const z = meta.z0 + j * meta.step;
        const raw = meta.raw ? meta.raw[k] : g.heights[k];
        const want = carveWiden(plain, raw, x, z, meta.step / 2);
        if (!Object.is(g.heights[k], want)) farBad ||= `${x},${z}`;
        const near = Math.fround(plain.carveAt(raw, x, z));
        if (want !== near) widened++;
        samples++;
      }
  }
  ok(!farBad && samples > 0, `${world}: a far grid's ${samples} samples are the carve of their raw heights with a widening of half a far step${farBad ? ` (apart at ${farBad})` : ''}`);
  ok(widened > 0, `${world}: and ${widened} of them, within half a far step of a road, stand at its surface where the block's pole under them would not`);
}

// Monument: the pole grid, and heightAt carved then edited.
{
  const mon = PLANETS.find((p) => p.id === 'monument');
  const rawFile = mon?.dem ? join(REPO, 'public', mon.dem.url.replace(/^\//, ''), 'base16.raw') : '';
  if (!mon?.dem || !existsSync(rawFile)) note('no Monument raster in this checkout: its half is skipped');
  else {
    const raw = readFileSync(rawFile);
    const meta = JSON.parse(readFileSync(join(REPO, 'public', mon.dem.url.replace(/^\//, ''), 'base.json'), 'utf8'));
    const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
    const d = mon.dem;
    const t = new Terrain(mon);
    const patch = makeDemPatch(buf, meta, { size: d.size, lift: d.lift, feather: d.feather ?? 0 });
    t.demDetail = d.detail ?? 0;
    t.dem = patch;
    t.minH = patch.minHeight + patch.lift;
    t.maxH = patch.maxHeight + patch.lift;
    t.floor = t.minH - 30;
    // A figure eight lifted onto the raster's own ground near the origin.
    const lift = t.groundRawAt(0, 0);
    const e = figureEight('eight', 8);
    for (const n of e.course!.paths[0].nodes) n.y += lift;
    const store = storeOf([e]);
    const grid = new CourseGrid(store);
    grid.all();
    grid.step(Infinity, 0, 0, () => 0);
    t.courseGrid = grid;
    let worst = 0;
    let poles = 0;
    for (let z = -200; z <= 200; z += 2)
      for (let x = -200; x <= 200; x += 2) {
        const r = t.groundRawAt(-x, z);
        const a = grid.carveAt(r, x, z);
        const b = store.carveAt(r, x, z);
        worst = Math.max(worst, Math.abs(a - b));
        poles++;
      }
    ok(worst < 2e-3, `Monument: the pole grid is the carve at every one of ${poles} poles to ${worst.toExponential(2)} m (its surface and weight kept premultiplied in float32)`);
    // Between its poles, bilinear over the four round it: one raw height under all five, the read at a point between is the
    // four poles' reads weighed by where it stands (what the 2 m mesh draws), never the nearest pole's.
    {
      let between = 0;
      let moved = 0;
      let bad = '';
      for (let z = -150; z <= 150; z += 6)
        for (let x = -150; x <= 150; x += 6) {
          const u = 0.37;
          const v = 0.71;
          const r = 3.5;
          const a00 = grid.carveAt(r, x, z);
          const a10 = grid.carveAt(r, x + 2, z);
          const a01 = grid.carveAt(r, x, z + 2);
          const a11 = grid.carveAt(r, x + 2, z + 2);
          const want = (a00 * (1 - u) + a10 * u) * (1 - v) + (a01 * (1 - u) + a11 * u) * v;
          const got = grid.carveAt(r, x + 2 * u, z + 2 * v);
          between++;
          if (Math.abs(a00 - a11) > 0.01) moved++;
          if (Math.abs(got - want) > 1e-9) bad ||= `${x + 2 * u},${z + 2 * v}: ${got} against ${want}`;
        }
      ok(!bad && moved > 50, `Monument: between its poles the pole grid's read is bilinear over the four round it (${between} points, ${moved} where the poles differ)${bad ? `: ${bad}` : ''}`);
    }
    // Heights over it: heightAt is the carve, then the edit.
    const h = new HeightEdits();
    const dd = h.writable(0, 0)!;
    for (let k = 0; k < dd.length; k++) dd[k] = 0.5 + (k % 7) * 0.1;
    t.heights = h;
    let orderBad = '';
    for (let k = 0; k < 500; k++) {
      const gx = -((k * 13) % 64) - 0.3;
      const gz = ((k * 29) % 64) + 0.7;
      const carvedH = grid.carveAt(t.groundRawAt(gx, gz), -gx, gz);
      const dlt = h.bilinear(-gx, gz);
      const want = dlt !== 0 ? carvedH + dlt : carvedH;
      if (!Object.is(t.heightAt(gx, gz), want)) orderBad ||= `${gx},${gz}`;
      if (!Object.is(t.groundBaseAt(gx, gz), carvedH)) orderBad ||= `base ${gx},${gz}`;
    }
    ok(!orderBad, `Monument: heightAt is the carve, then the edit over it, and groundBaseAt the carve alone${orderBad ? ` (apart at ${orderBad})` : ''}`);
    // The cost of a Monument heightAt with a course, measured, held as a bound.
    t.heights = null;
    const N = 200000;
    let sink = 0;
    for (let k = 0; k < 20000; k++) sink += t.heightAt(-(k % 300) + 0.5, (k % 211) - 100.5);
    const t0 = performance.now();
    for (let k = 0; k < N; k++) sink += t.heightAt(-(k % 300) + 0.5, (k % 211) - 100.5);
    const us = ((performance.now() - t0) * 1000) / N;
    t.courseGrid = null;
    const t1 = performance.now();
    for (let k = 0; k < N; k++) sink += t.heightAt(-(k % 300) + 0.5, (k % 211) - 100.5);
    const usBare = ((performance.now() - t1) * 1000) / N;
    ok(us < 3 && Number.isFinite(sink), `Monument: a heightAt with a course costs ${us.toFixed(2)} µs against ${usBare.toFixed(2)} µs without (measured about 0.15 µs on the pass's machine; bound 3 µs)`);
  }
}

console.log(`\ncourseApply: ${checks} checks passed`);
