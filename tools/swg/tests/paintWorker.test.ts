// The paint on both threads (Map-maker II, DESIGN.md §2.5, W2):
//
//   1. a `TerrainWorkerCore` handed `init` with a paint, a `paint` message changing it, and `generate`, and the main
//      thread's sampler holding the same paint, answer every map of every grid equal by `Object.is` -- on the made
//      terrain (follow on and off, at 4 m cells and at a file's 8 m, whose message the worker's paint is made at) and on a
//      converted world on disk; every grid carries the revision it was made at;
//   2. the `SwgTerrain` glue over a stand-in worker (`useWorkerForTest`): a grid asked for before a stroke was let go and
//      answered after it (older than its tile's revision) is asked for again and never put; the answer at the revision
//      in force is put; a block made again for the paint replaces the cached block as it lands, the world told; a block
//      made again far from every painted tile is never stale; a far grid cached and painted under is asked of the worker
//      over its own place and lands as the far grid a terrain of its own makes with the paint, the world told; and a
//      block's height edit is laid on it as it lands.
//
// Run: node tools/swg/tests/paintWorker.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GroundPaint, paintTileNumber } from '../../../src/swg/terrain/groundPaint.ts';
import { TerrainSampler, parseTerrainTemplate } from '../../../src/swg/terrain/trn.ts';
import { TerrainWorkerCore } from '../../../src/swg/terrain/workerCore.ts';
import { HeightEdits } from '../../../src/swg/terrain/heightEdits.ts';
import { SwgTerrain, type TerrainReply } from '../../../src/world/swgTerrain.ts';
import { cellPaint, colourCell, paintTerrainBytes, sameArrays } from './paintHarness.ts';
import { groundWorlds, PACKS, sampleBlocks } from './terrainHarness.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);

// ---------------------------------------------------------------- 1. the worker and the main thread

async function bothThreads(name: string, trn: Uint8Array, pack: string, places: { x: number; z: number }[], n: number, step: number, cell = 4): Promise<void> {
  const template = parseTerrainTemplate(trn);
  const group = template.generator.shaderGroup;
  const fams = [...group.families.values()].filter((f) => f.children.length).slice(0, 3);
  const at = cell === 4 ? '' : ` (${cell} m cells)`;
  for (const follow of [true, false]) {
    const main = new GroundPaint(cell);
    main.resolve(fams.map((f, i) => (i === 1 && f.children.length > 1 ? { pack, name: f.name, child: 1 } : { pack, name: f.name })), group, pack);
    main.follow = follow;
    for (const p of places) {
      const c0x = Math.floor(p.x / cell);
      const c0z = Math.floor(p.z / cell);
      for (let cz = c0z; cz < c0z + (n * step) / cell; cz++) for (let cx = c0x; cx < c0x + (n * step) / cell; cx += 2) cellPaint(main, cx, cz, 1 + ((cx + cz) & 1));
      colourCell(main, c0x + 2, c0z + 2, 200, 40, 10, 180);
    }
    ok(main.cell === cell && main.fam.size > 0, `${name}${at}: the main thread paints at ${cell} m cells`);
    const sampler = new TerrainSampler(template);
    sampler.paint = main;
    const core = new TerrainWorkerCore();
    const ready = core.handle({ type: 'init', trn: trn.slice().buffer, layers: [], bitmaps: [], ramps: [], paint: main.message(null, null, true), rev: 1 });
    ok(ready.message.type === 'ready', `${name}${at}: the worker takes its init with a paint`);
    let same = true;
    let revs = true;
    let painted = 0;
    const plainS = new TerrainSampler(template);
    places.forEach((p, id) => {
      const m = core.handle({ type: 'generate', id, startX: p.x, startZ: p.z, n, step }).message;
      const here = sampler.generate(p.x, p.z, n, step);
      if (!sameArrays(here, m)) same = false;
      if (m.rev !== 1) revs = false;
      const own = plainS.generate(p.x, p.z, n, step);
      for (let i = 0; i < own.shaders.length; i++) if (own.shaders[i] !== (m.shaders as Int32Array)[i]) painted++;
    });
    ok(same && revs && painted > 0, `${name}${at}, follow ${follow ? 'on' : 'off'}: every map of ${places.length} grids the worker makes with the paint handed at its init equals the main thread's by Object.is (${painted} poles painted), each grid carrying the revision it was made at`);
    // A stroke: the paint changed here, its tiles handed over by name.
    const touched = new Set<number>();
    for (const p of places) {
      const cx = Math.floor(p.x / cell) + 3;
      const cz = Math.floor(p.z / cell) + 3;
      cellPaint(main, cx, cz, 3);
      colourCell(main, cx, cz, 9, 99, 199, 255);
      touched.add(paintTileNumber(Math.floor(cx / main.n), Math.floor(cz / main.n)));
    }
    const answer = core.handle({ type: 'paint', rev: 2, paint: main.message(touched, touched, false) });
    ok(answer.message.type === 'painted' && answer.message.rev === 2, `${name}${at}: a \`paint\` message is taken and answered with its revision`);
    same = true;
    revs = true;
    places.forEach((p, id) => {
      const m = core.handle({ type: 'generate', id, startX: p.x, startZ: p.z, n, step }).message;
      if (!sameArrays(sampler.generate(p.x, p.z, n, step), m)) same = false;
      if (m.rev !== 2) revs = false;
    });
    ok(same && revs, `${name}${at}, follow ${follow ? 'on' : 'off'}: after the stroke's tiles are handed over, every map again equals the main thread's, at the new revision`);
    // Let go whole.
    core.handle({ type: 'paint', rev: 3, paint: null });
    const plain = new TerrainSampler(template);
    same = places.every((p, id) => sameArrays(plain.generate(p.x, p.z, n, step), core.handle({ type: 'generate', id, startX: p.x, startZ: p.z, n, step }).message));
    ok(same, `${name}${at}: a paint let go (null) makes the worker's grids the unpainted ground's`);
  }
}

await bothThreads('the made terrain', paintTerrainBytes(), 'test', [{ x: -36, z: -36 }, { x: 60, z: -4 }, { x: 500, z: 508 }], 37, 2);
// A file of 8 m cells (a later change of the cell is a value): the worker's paint is made at the message's own cell.
await bothThreads('the made terrain', paintTerrainBytes(), 'test', [{ x: -36, z: -36 }, { x: 60, z: -4 }, { x: 500, z: 508 }], 37, 2, 8);
const worlds = groundWorlds();
const world = worlds.includes('yavin4') ? 'yavin4' : worlds[0];
if (world) {
  const trn = new Uint8Array(readFileSync(join(PACKS, world, 'terrain.trn')));
  const t = parseTerrainTemplate(trn);
  const s = new TerrainSampler(t);
  const places = sampleBlocks(t, 3, 99).map((b) => s.blockStart(b.bx, b.bz));
  await bothThreads(world, trn, world, places, s.numberOfPoles, s.poleStep);
} else note(`no converted world under ${PACKS}: the worker is held on the made terrain alone`);

// ---------------------------------------------------------------- 2. the glue over a stand-in worker

{
  const trn = paintTerrainBytes();
  const buf = trn.slice().buffer;
  const heights = new HeightEdits();
  const paint = new GroundPaint();
  const swg = await SwgTerrain.create(buf, [], 0, 0, async () => null, { heights, paint, paintResolve: (group) => paint.resolve([{ pack: 'test', name: 'grass' }], group, 'test') });
  const posted: { type: string; id?: number; startX?: number; startZ?: number; n?: number; step?: number; rev?: number }[] = [];
  swg.useWorkerForTest({ postMessage: (m) => posted.push(m as never), terminate: () => {} });
  // The stand-in worker: its own core, fed every message the terrain posts, answering when the test says.
  const core = new TerrainWorkerCore();
  core.handle({ type: 'init', trn: buf.slice(0), layers: [], bitmaps: [], ramps: [], paint: null, rev: 0 });
  const feed = () => {
    const out: TerrainReply[] = [];
    while (posted.length) {
      const m = posted.shift()!;
      const r = core.handle(m as never).message as TerrainReply;
      if (r.type === 'grid') out.push(r);
    }
    return out;
  };
  // A block asked for: block (1, 0), whose poles run from about 60 m to 130 m on x.
  ok(!swg.prepareArea(swg.toGameX(100), 10, 1, false), 'a block not cached is asked of the stand-in worker');
  const first = posted.filter((m) => m.type === 'generate');
  ok(first.length >= 1, `and the terrain posts its generate (${first.length})`);
  // Its grid is made now, at the revision in force (none painted)...
  const early = feed();
  // ...and before the answer lands a stroke is let go over it: a cell of grass painted under the block and posted.
  cellPaint(paint, 25, 3, 1);
  const tile = paintTileNumber(0, 0);
  const rev = swg.postPaint([tile], [], false);
  ok(rev === 1 && posted.at(-1)?.type === 'paint', `the stroke's tile is posted to the worker at revision ${rev}`);
  const repainted: string[] = [];
  swg.onRepainted = (kind, x0, z0) => repainted.push(`${kind} ${x0},${z0}`);
  for (const r of early) swg.handleReply(r);
  ok(swg.paintWork.stale === early.length && !swg.sampler.hasBlock(1, 0), `a grid made before the stroke and answered after it is older than its tile's revision: asked for again (${swg.paintWork.stale}), never put`);
  const again = posted.filter((m) => m.type === 'generate');
  ok(again.length === early.length && again.every((m, i) => m.startX === first[i].startX && m.startZ === first[i].startZ), 'and asked for again as it was');
  for (const r of feed()) swg.handleReply(r);
  ok(swg.sampler.hasBlock(1, 0), 'the answer at the revision in force is put');
  const block = swg.sampler.generateBlock(1, 0);
  const s = swg.sampler.blockStart(1, 0);
  const i = ((12 - s.z) / 2) * swg.sampler.numberOfPoles + (100 - s.x) / 2;
  ok(block.shaders[i] === 2, `and carries the stroke's grass at its cell (x 100, z 12: family ${block.shaders[i]})`);
  // A block made again for the paint replaces the cached one as it lands.
  cellPaint(paint, 26, 3, 1);
  swg.postPaint([tile], [], false);
  const asked = swg.repaint(98, 6, 110, 18);
  ok(asked >= 1 && swg.sampler.generateBlock(1, 0) === block, `a repaint asks the worker for the block again (${asked}) and the cached one stands until it lands`);
  for (const r of feed()) swg.handleReply(r);
  const newer = swg.sampler.generateBlock(1, 0);
  const j = ((12 - s.z) / 2) * swg.sampler.numberOfPoles + (104 - s.x) / 2;
  ok(newer !== block && newer.shaders[j] === 2, 'the newer grid replaces the block as it lands, with the new cell in it');
  ok(repainted.some((r) => r.startsWith('block')), `and the world is told (${repainted.join('; ')})`);
  // A block far from every painted tile is never stale, whatever the revision.
  const staleBefore = swg.paintWork.stale;
  swg.prepareArea(swg.toGameX(3000), 3000, 1, false);
  swg.postPaint([tile], [], false);
  for (const r of feed()) swg.handleReply({ ...r, rev: 0 });
  ok(swg.paintWork.stale === staleBefore && swg.sampler.hasBlock(Math.floor(3000 / 64), Math.floor(3000 / 64)), 'a grid whose tiles no stroke marked is put whatever revision it was made at');
  // A far grid cached, then painted under and made again for the paint: asked of the worker over its own place, and as it
  // lands the very far grid a terrain of its own makes with the paint, the world told.
  const far = { gx0: -160, gz0: 0, size: 64, res: 4 };
  ok(swg.farGrid(far.gx0, far.gz0, far.size, far.res, false) === null, 'a far grid not cached is asked of the stand-in worker');
  for (const r of feed()) swg.handleReply(r);
  const farBefore = swg.farGrid(far.gx0, far.gz0, far.size, far.res, false)!;
  ok(!!farBefore, 'and filed as it lands');
  for (let cz = 0; cz <= 16; cz++) for (let cx = 24; cx <= 40; cx++) cellPaint(paint, cx, cz, 1);
  swg.postPaint([tile], [], false);
  repainted.length = 0;
  const farAsked = swg.repaint(96, 0, 160, 64);
  ok(farAsked >= 1 && swg.farGrid(far.gx0, far.gz0, far.size, far.res, false) === farBefore, `a repaint under it asks the worker for it again (${farAsked} grids) and the cached one stands until it lands`);
  for (const r of feed()) swg.handleReply(r);
  const farNow = swg.farGrid(far.gx0, far.gz0, far.size, far.res, false)!;
  const copy = new GroundPaint();
  copy.take(paint.message(null, null, true));
  const ref = await SwgTerrain.create(buf.slice(0), [], 0, 0, async () => null, { paint: copy });
  const farTruth = ref.farGrid(far.gx0, far.gz0, far.size, far.res, true)!;
  ref.dispose();
  const apartFar = (a: typeof farNow, b: typeof farNow) => (['heights', 'shaders', 'children', 'colors'] as const).reduce((n, k) => n + a[k].reduce((m, v, i) => m + (Object.is(v, b[k][i]) ? 0 : 1), 0), 0);
  ok(farNow !== farBefore && apartFar(farBefore, farTruth) > 0 && apartFar(farNow, farTruth) === 0 && repainted.some((r) => r.startsWith('far')), `the far grid made again lands as the far grid a terrain of its own makes with the paint (${apartFar(farBefore, farTruth)} values moved), and the world is told (${repainted.filter((r) => r.startsWith('far')).join('; ')})`);
  // A block that lands while a stroke's preview holds it: the preview's kept ground for it goes, so the next stamp lays the
  // paint over the block that landed, never over the one the stroke first found. A cell erased by a write (its block asked
  // for again) and a stroke previewing over the block before the answer lands: once it has landed, the erased cell shows.
  const yx = 112;
  const yz = 8;
  const bs = swg.sampler.blockStart(1, 0);
  const yi = ((yz - bs.z) / 2) * swg.sampler.numberOfPoles + (yx - bs.x) / 2;
  const painted = swg.sampler.generateBlock(1, 0).shaders[yi];
  cellPaint(paint, 28, 2, 0);
  swg.postPaint([tile], [], false);
  swg.repaint(108, 4, 116, 12);
  swg.previewPaint(swg.toGameX(116), 4, swg.toGameX(108), 12);
  const heldOld = swg.sampler.generateBlock(1, 0).shaders[yi];
  for (const r of feed()) swg.handleReply(r);
  swg.previewPaint(swg.toGameX(116), 4, swg.toGameX(108), 12);
  const shown = swg.sampler.generateBlock(1, 0).shaders[yi];
  const own = new TerrainSampler(parseTerrainTemplate(trn)).generateBlock(1, 0).shaders[yi];
  ok(painted === 2 && heldOld === 2 && shown === own && own !== 2, `a block that lands under a stroke's preview lets the preview's kept ground for it go: the next stamp shows the erased cell as the ground's own (family ${shown}, painted ${painted})`);
  swg.sampler.endPreview();
  // A height edit laid on a block as it lands.
  const d = heights.writable(1, 1)!;
  d.fill(2.5);
  swg.useHeights(heights);
  swg.prepareArea(swg.toGameX(100), 70, 1, false);
  for (const r of feed()) swg.handleReply(r);
  const edited = swg.sampler.generateBlock(1, 1);
  const raw = new TerrainSampler(parseTerrainTemplate(trn)).generateBlock(1, 1);
  const k = ((70 - swg.sampler.blockStart(1, 1).z) / 2) * swg.sampler.numberOfPoles + (100 - swg.sampler.blockStart(1, 1).x) / 2;
  ok(Math.abs(edited.heights[k] - raw.heights[k] - heights.bilinear(100, 70)) < 1e-6 && heights.bilinear(100, 70) > 0, `a block the worker made enters the cache with its height edit laid on (${raw.heights[k]} raw, ${edited.heights[k]} landed)`);
  swg.dispose();
}

console.log(`\npaintWorker: ${checks} checks passed`);
