// The proof that no flora paint is the third wave's world to the bit (Map-maker II's fourth wave, DESIGN.md §2.6, W4):
// 0a86da7's `trn.ts`, `generator.ts`, `groundPaint.ts`, `swgTerrain.ts` and `workerCore.ts` loaded out of git beside
// today's, and on every converted world on disk (SWG3JS_PACKS, else assets-private) the four flora maps of 16 blocks, the
// far map of four far grids, the grass a near chunk places from its blocks and the cards a far tile places from its grid
// (`placeGrass`, `placeFarCards`, by every buffer of their tufts) and the worker's grids, every array by `Object.is`, three
// ways: no paint, an empty paint, and a paint of the third wave's kind (family and colour tiles, a palette resolved) beside
// flora tiles whose recipe keeps every class (the flora layer laid and moving nothing), that last way held against a fresh
// 0a86da7 terrain and worker fed the third wave's own paint of the same tiles from before their first grid (the worker's
// families, alternates and colours with its flora). And Monument, a real-elevation world:
// with no flora row its paint's source plants nothing (no tree, no plant, no tuft, no far card), and its arrival loads
// nothing for it (read as text: the plants are asked for only where the paint holds a flora tile).
//
// Run: node tools/swg/tests/floraPaintIdentity.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SwgTerrain } from '../../../src/world/swgTerrain.ts';
import { GroundPaint, PAINT_TILE } from '../../../src/swg/terrain/groundPaint.ts';
import { TerrainWorkerCore } from '../../../src/swg/terrain/workerCore.ts';
import { readRadialFile } from '../../../src/swg/terrain/radialFile.ts';
import { shaderKey } from '../../../src/swg/terrain/shaderKey.ts';
import type { RadialChild } from '../../../src/swg/terrain/flora.ts';
import { FAR_CARD_DEFAULTS, GRASS_DEFAULTS, GRASS_SWAY_DEFAULTS, candidateCapacity, placeFarCards, placeGrass, placeStats, tuftBuffers, type GrassSource, type GrassWorld, type TuftBuffers } from '../../../src/world/grassMath.ts';
import { SWAY_DEFAULTS } from '../../../src/world/swayMath.ts';
import { groundChunkOrigin } from '../../../src/world/groundTiles.ts';
import { PaintFloraSource } from '../../../src/world/paintFlora.ts';
import { groundWorlds, PACKS, sampleBlocks } from './terrainHarness.ts';
import { loadOldMany, REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);

const W3 = '0a86da7';
const mods = await loadOldMany(['src/swg/terrain/trn.ts', 'src/swg/terrain/generator.ts', 'src/swg/terrain/groundPaint.ts', 'src/world/swgTerrain.ts', 'src/swg/terrain/workerCore.ts'], ['src/world/swgTerrain.ts', 'src/swg/terrain/workerCore.ts', 'src/swg/terrain/groundPaint.ts'], W3);
if (!mods) note(`git cannot hand ${W3} over here: the day-one comparison is skipped`);
const OldSwg = mods?.[0].SwgTerrain as typeof SwgTerrain | undefined;
const OldCore = mods?.[1].TerrainWorkerCore as typeof TerrainWorkerCore | undefined;
const OldPaint = mods?.[2].GroundPaint as typeof GroundPaint | undefined;

const FLORA = ['floraCollidable', 'floraNonCollidable', 'radialNear', 'radialFar'] as const;
const same = (a: ArrayLike<number> | undefined, b: ArrayLike<number> | undefined): boolean => {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
};
const sameTufts = (a: TuftBuffers, b: TuftBuffers): boolean => a.count === b.count && same(a.tuft.subarray(0, a.count * 4), b.tuft.subarray(0, b.count * 4)) && same(a.size.subarray(0, a.count * 4), b.size.subarray(0, b.count * 4)) && same(a.tint.subarray(0, a.count * 4), b.tint.subarray(0, b.count * 4)) && same(a.sway.subarray(0, a.count * 4), b.sway.subarray(0, b.count * 4)) && same(a.normal.subarray(0, a.count * 3), b.normal.subarray(0, b.count * 3));

function centreOf(world: string): { x: number; z: number } | null {
  const file = join(PACKS, world, 'layout.json');
  if (!existsSync(file)) return null;
  const m = /"center"\s*:\s*\{\s*"x"\s*:\s*(-?[\d.]+)\s*,\s*"z"\s*:\s*(-?[\d.]+)/.exec(readFileSync(file, 'utf8').slice(0, 8000));
  return m ? { x: Number(m[1]), z: Number(m[2]) } : null;
}

const FAR_TILE = 512;
const FAR_RES = 32;
const FARS: [number, number][] = [
  [0, 0],
  [-1, 1],
  [2, -1],
  [-2, -2],
];

/** A paint of the third wave's kind over a raw rectangle (two families and a colour a tile) and flora tiles whose recipe keeps every class. */
function wavePaint(group: SwgTerrain['template']['generator']['shaderGroup'], gen: SwgTerrain['template']['generator'], pack: string, x0: number, z0: number, x1: number, z1: number): GroundPaint {
  const p = new GroundPaint();
  const names = [...group.families.values()].slice(0, 2).map((f) => ({ pack, name: f.name }));
  p.resolve(names, group, pack);
  p.resolveRecipes([{}], gen.floraGroup, gen.radialGroup, pack);
  for (let tz = Math.floor(Math.min(z0, z1) / PAINT_TILE); tz <= Math.floor(Math.max(z0, z1) / PAINT_TILE); tz++) {
    for (let tx = Math.floor(Math.min(x0, x1) / PAINT_TILE); tx <= Math.floor(Math.max(x0, x1) / PAINT_TILE); tx++) {
      // Families in a check of 32 m squares (palette 1 and 2, every third square left the world's own), a colour at half.
      const fam = p.familyTile(tx, tz, true)!;
      const col = p.colourTile(tx, tz, true)!;
      for (let i = 0; i < p.n * p.n; i++) {
        const sq = ((i % p.n) >> 3) + ((Math.floor(i / p.n) >> 3) * 5);
        fam[i] = sq % 3 === 2 ? 0 : 1 + (sq % 3);
        col[i * 4] = 180;
        col[i * 4 + 1] = 120 + (sq % 7) * 10;
        col[i * 4 + 2] = 60;
        col[i * 4 + 3] = 128;
      }
      // Flora tiles: recipe 1 (which keeps every class) at amounts from nought to whole.
      const flo = p.floraTile(tx, tz, true)!;
      for (let i = 0; i < p.n * p.n; i++) {
        flo[i * 2] = 1;
        flo[i * 2 + 1] = (i * 37) & 255;
      }
    }
  }
  p.boundsAgain();
  return p;
}

const worlds = groundWorlds();
if (!worlds.length) note(`no converted worlds under ${PACKS}: the converted half is skipped`);
let tufts = 0;
let cards = 0;
for (const world of OldSwg && OldCore && OldPaint ? worlds : []) {
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
  const fetchBytes = async (file: string) => bytes(file);
  const old = await OldSwg!.create(trn, [], c.x, c.z, fetchBytes);
  const blocks = sampleBlocks(old.template as never, 16, 2718);
  // The grass's world: the pack's own radial list where it has one (else every shader a picture of its own, so a tuft is placed).
  const radialJson = bytes('terrain/radial.json');
  const file = radialJson ? readRadialFile(JSON.parse(new TextDecoder().decode(radialJson))) : null;
  const keys = new Map<RadialChild, string>();
  for (const f of old.template.generator.radialGroup.families.values()) for (const ch of f.children) keys.set(ch, shaderKey(ch.shader));
  const shaders = file?.shaders ?? new Map([...keys.values()].map((k, i) => [k, { layer: i, near: true, far: true, alphaRef: 0, kind: 'plain' as const, width: 256, height: 256 }]));
  const gworld: GrassWorld = { group: old.template.generator.radialGroup, shaders, keyOf: (ch) => keys.get(ch)! };
  const near = old.template.flora.radial;
  const far = old.template.flora.farRadial;
  // Four grass chunks, in the game's frame, at the first four blocks.
  const grassAt = blocks.slice(0, 4).map((b) => ({ x: Math.floor(old.toGameX(b.bx * 64 + 32) / 64) * 64, z: Math.floor(old.toGameZ(b.bz * 64 + 32) / 64) * 64 }));
  const place = (src: SwgTerrain) => {
    const out: TuftBuffers[] = [];
    for (const g of grassAt) {
      src.prepareArea(g.x - 2, g.z - 2, 68, true);
      const b = tuftBuffers(candidateCapacity(near, 64));
      placeGrass(src as unknown as GrassSource, gworld, near, g.x, g.z, 64, [], GRASS_DEFAULTS, GRASS_SWAY_DEFAULTS, SWAY_DEFAULTS, b, placeStats());
      out.push(b);
    }
    for (const [tx, tz] of FARS) {
      const o = groundChunkOrigin(tx, tz, src.groundShift, FAR_TILE);
      const grid = src.farGrid(o.x, o.z, FAR_TILE, FAR_RES, true)!;
      const step = FAR_TILE / FAR_RES;
      const b = tuftBuffers(candidateCapacity(far, FAR_TILE));
      placeFarCards(src as unknown as GrassSource, gworld, far, o.x, o.z, FAR_TILE, { heights: grid.heights, colors: grid.colors, radialFar: grid.radialFar, n: FAR_RES + 3, step, gx0: o.x - step, gz0: o.z - step }, 2.5, () => [], FAR_CARD_DEFAULTS, b, placeStats());
      out.push(b);
    }
    return out;
  };
  const oldBlocks = blocks.map((b) => old.sampler.generateBlock(b.bx, b.bz));
  const oldFars = FARS.map(([tx, tz]) => {
    const o = groundChunkOrigin(tx, tz, old.groundShift, FAR_TILE);
    return old.farGrid(o.x, o.z, FAR_TILE, FAR_RES, true)!;
  });
  const oldPlaced = place(old);
  const oldCore = new OldCore!();
  oldCore.handle({ type: 'init', trn: trn.slice(0), layers: [], bitmaps: [], ramps: [] });
  const st0 = old.sampler.blockStart(blocks[0].bx, blocks[0].bz);
  const oldGrid = oldCore.handle({ type: 'generate', id: 1, startX: st0.x, startZ: st0.z, n: old.sampler.numberOfPoles, step: old.sampler.poleStep }).message as unknown as Record<string, Uint8Array>;
  // The raw rectangle every place asked reaches.
  const xs: number[] = [];
  const zs: number[] = [];
  for (const b of blocks) xs.push(b.bx * 64 - 8, b.bx * 64 + 72), zs.push(b.bz * 64 - 8, b.bz * 64 + 72);
  xs.push(old.toSwgX(-1600), old.toSwgX(1600));
  zs.push(old.toSwgZ(-1600), old.toSwgZ(1600));
  for (const way of ['none', 'empty', 'wave three and keeping flora'] as const) {
    const now0 = way === 'none' ? null : way === 'empty' ? new GroundPaint() : null;
    let paint: GroundPaint | null = now0;
    const now = await SwgTerrain.create(trn, [], c.x, c.z, fetchBytes, {});
    const painted = way === 'wave three and keeping flora';
    // The painted way's old side: a fresh 0a86da7 terrain holding the third wave's own paint of the same tiles from before
    // its first grid (the old terrain above caches its far grids and blocks unpainted), and its worker fed the same paint.
    let oldHere = old;
    let oldFarsHere = oldFars;
    let oldPlacedHere = oldPlaced;
    let oldGridHere = oldGrid;
    if (painted) {
      paint = wavePaint(now.template.generator.shaderGroup, now.template.generator, world, Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs));
      // The third wave's own paint of the same tiles over the old terrain, so both lay the same families and colours.
      const op = new OldPaint!();
      op.resolve([...old.template.generator.shaderGroup.families.values()].slice(0, 2).map((f) => ({ pack: world, name: f.name })), old.template.generator.shaderGroup, world);
      for (const key of paint.fam.keys()) {
        op.fam.set(key, paint.fam.get(key)!.slice());
        op.col.set(key, paint.col.get(key)!.slice());
      }
      op.boundsAgain();
      old.sampler.paint = op as unknown as GroundPaint;
      oldHere = await OldSwg!.create(trn, [], c.x, c.z, fetchBytes);
      oldHere.sampler.paint = op as unknown as GroundPaint;
      oldFarsHere = FARS.map(([tx, tz]) => {
        const o = groundChunkOrigin(tx, tz, oldHere.groundShift, FAR_TILE);
        return oldHere.farGrid(o.x, o.z, FAR_TILE, FAR_RES, true)!;
      });
      oldPlacedHere = place(oldHere);
      const oc = new OldCore!();
      oc.handle({ type: 'init', trn: trn.slice(0), layers: [], bitmaps: [], ramps: [], paint: (op as unknown as GroundPaint).message(null, null, true), rev: 1 } as never);
      oldGridHere = oc.handle({ type: 'generate', id: 1, startX: st0.x, startZ: st0.z, n: old.sampler.numberOfPoles, step: old.sampler.poleStep }).message as unknown as Record<string, Uint8Array>;
    }
    now.sampler.paint = paint;
    let failed = '';
    const oldBlocksNow = painted ? blocks.map((b) => {
      const st = old.sampler.blockStart(b.bx, b.bz);
      return old.sampler.generate(st.x, st.z, old.sampler.numberOfPoles, old.sampler.poleStep);
    }) : oldBlocks;
    blocks.forEach((b, i) => {
      const st = now.sampler.blockStart(b.bx, b.bz);
      const g = now.sampler.generate(st.x, st.z, now.sampler.numberOfPoles, now.sampler.poleStep);
      for (const k of FLORA) if (!same(oldBlocksNow[i][k], g[k])) failed ||= `block ${b.bx},${b.bz} ${k}`;
    });
    FARS.forEach(([tx, tz], i) => {
      const o = groundChunkOrigin(tx, tz, now.groundShift, FAR_TILE);
      const g = now.farGrid(o.x, o.z, FAR_TILE, FAR_RES, true)!;
      if (!same(oldFarsHere[i].radialFar, g.radialFar) || !same(oldFarsHere[i].heights, g.heights) || (painted && !same(oldFarsHere[i].colors, g.colors))) failed ||= `far grid ${tx},${tz}`;
    });
    const placed = place(now);
    placed.forEach((b, i) => {
      if (!sameTufts(oldPlacedHere[i], b)) failed ||= i < 4 ? `the grass of chunk ${i}` : `the far cards of tile ${i - 4}`;
    });
    if (way === 'none') {
      tufts += placed.slice(0, 4).reduce((t, b) => t + b.count, 0);
      cards += placed.slice(4).reduce((t, b) => t + b.count, 0);
    }
    // The worker's grid with the paint handed at its init.
    const core = new TerrainWorkerCore();
    core.handle({ type: 'init', trn: trn.slice(0), layers: [], bitmaps: [], ramps: [], paint: paint && !paint.empty ? paint.message(null, null, true) : null, rev: 1 });
    const g = core.handle({ type: 'generate', id: 1, startX: st0.x, startZ: st0.z, n: now.sampler.numberOfPoles, step: now.sampler.poleStep }).message as unknown as Record<string, Uint8Array>;
    for (const k of FLORA) if (!same(oldGridHere[k], g[k])) failed ||= `the worker's grid ${k}`;
    // And with the third wave's paint, its families, children and colours as the old worker laid them.
    if (painted) for (const k of ['shaders', 'children', 'colors'] as const) if (!same(oldGridHere[k], g[k])) failed ||= `the worker's grid ${k}`;
    // And the paint reached what was compared (its colours are not the unpainted grid's), so the comparison is not of two bare grids.
    if (painted && same(oldGrid.colors, g.colors)) failed ||= "the painted worker's grid carries no paint";
    ok(!failed, `${world}, ${way === 'none' ? 'no paint' : way === 'empty' ? 'an empty paint' : "the third wave's family and colour paint beside flora tiles that keep every class"}: the four flora maps of 16 blocks, four far grids, the grass of four chunks and the far cards of four tiles, and the worker's grid are ${W3}'s by Object.is${failed ? ` (first apart: ${failed})` : ''}`);
    old.sampler.paint = null;
    if (oldHere !== old) oldHere.dispose();
    now.dispose();
  }
  old.dispose();
}
if (worlds.length && OldSwg) ok(tufts > 0 && cards > 0, `the grass and the far cards were held where they stand: ${tufts} tufts and ${cards} far cards over every world compared`);

// ---------------------------------------------------------------- a real-elevation world with no flora row

{
  const lent = worlds.includes('lok') ? 'lok' : worlds[0];
  if (lent) {
    const trn = readFileSync(join(PACKS, lent, 'terrain.trn'));
    const table = await SwgTerrain.create(trn.buffer.slice(trn.byteOffset, trn.byteOffset + trn.byteLength) as ArrayBuffer, [], 0, 0, async () => null, { tableOnly: true });
    const gen = table.template.generator;
    for (const paint of [null, new GroundPaint()]) {
      const src = new PaintFloraSource(() => paint, { flora: table.template.flora, floraGroup: gen.floraGroup, radialGroup: gen.radialGroup }, { heightAt: (x, z) => Math.sin(x * 0.01) * 20 + z * 0.01, waterHeightAt: () => -Infinity, colourAt: (_x, _z, o) => o.fill(255) }, 16288);
      let any = 0;
      for (let x = -4000; x < 4000; x += 37) for (let z = -4000; z < 4000; z += 41) {
        if (src.floraAt(x, z, true).family || src.floraAt(x, z, false).family) any++;
      }
      const pole = { family: 0, choice: 0, excluded: false, color: 0, height: 0, nx: 0, ny: 1, nz: 0 };
      for (let x = -2000; x < 2000; x += 13) {
        src.radialPoleIfCached(x, x * 0.7, false, pole);
        if (pole.family) any++;
        src.radialPoleIfCached(x, x * 0.7, true, pole);
        if (pole.family) any++;
      }
      const s = src.farSamples(0, 0, FAR_TILE, FAR_RES);
      if (s.radialFar.some((v) => v !== 0)) any++;
      ok(any === 0 && !src.paintedIn(0, 0, 64), `a real-elevation world's paint source with ${paint ? 'an empty paint' : 'no paint'} plants nothing: no tree, no plant, no tuft, no far card, and no chunk is the planter's`);
    }
    table.dispose();
  }
  const world = readFileSync(join(REPO, 'src/world/world.ts'), 'utf8').replace(/\r\n/g, '\n');
  ok(/this\.installDemPaint\(\);\n\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*if \(this\.groundPaint && this\.groundPaint\.flo\.size\) \{\n\s*const no = await this\.ensureDemFlora\(\);/.test(world), "a real-elevation world's arrival asks for its plants only where its paint holds a flora tile, behind its loading screen before its ground is made");
  ok(/const planted = this\.flora && \(!df \|\| df\.source\.paintedIn\(cx \* CHUNK_SIZE, cz \* CHUNK_SIZE, CHUNK_SIZE\)\);/.test(world), 'and a chunk its paint does not reach keeps the procedural props it always stood');
}

console.log(`\nfloraPaintIdentity: ${checks} checks passed`);
