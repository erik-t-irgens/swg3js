// The colour wash of ours on a real-elevation world (Map-maker II, DESIGN.md §2.5, W2, `demWash.ts`):
//
//   - its colour is its base where no band holds and it has no noise;
//   - each band laid where its height (metres above sea level) and slope hold, by the client's replace-with-amount at its
//     own amount (written out again here), in order, and nowhere else;
//   - its noise centred on nought: over a 64 m grid of Monument's whole raster the mean colour is within a hundredth of
//     the base (a share of a byte's full range), and it varies;
//   - a chunk of Monument drawn by the tile program carries the wash's colour at every sample (its height and its slope
//     as the chunk's own grid has them), and with no wash every sample is white, as before;
//   - colour paint laid over it, with the wash and without: at every sample the colour the paint lays at the sample's raw
//     place (game x mirrored), over the wash's colour or over white;
//   - the reader refuses what it does not read, in words, and its reference is the base.
//
// Run: node tools/swg/tests/demWash.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type * as THREE from 'three';
import { readWash, Wash } from '../../../src/world/demWash.ts';
import { CHUNK_RES, CHUNK_SIZE, Terrain, type ChunkTiler } from '../../../src/world/terrain.ts';
import { makeDemPatch } from '../../../src/world/demTerrain.ts';
import { DemShader } from '../../../src/world/demShader.ts';
import { PLANETS } from '../../../src/data/planets.ts';
import { GroundPaint } from '../../../src/swg/terrain/groundPaint.ts';
import { REPO } from './oldModules.ts';
import { colourCell } from './paintHarness.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);
const f = Math.fround;
/** The client's replace (computeColor's default branch), written out again. */
const replace = (old: number, desired: number, a: number) => (a < 1 ? Math.trunc(f(f(f(a) * desired) + f(f(1 - f(a)) * old))) : desired);

{
  const w = new Wash({ base: [120, 100, 80] });
  const out = new Uint8Array(3);
  let base = true;
  for (let i = 0; i < 200; i++) {
    w.colourAt(i * 37.3, -i * 11.1, i * 10 - 300, (i * 7) % 90, out);
    if (out[0] !== 120 || out[1] !== 100 || out[2] !== 80) base = false;
  }
  ok(base, 'with no band and no noise every place is the base');
  const r = w.reference;
  ok(Math.abs(r.rgb[0] - 120 / 255) < 1e-12 && Math.abs(r.luminance - (0.2126 * 120 + 0.7152 * 100 + 0.0722 * 80) / 255) < 1e-12, "the tint's reference is the base, each channel and Rec. 709's luminance");
}

{
  const bands = [
    { above: 100, below: 500, colour: [200, 180, 40] as [number, number, number], amount: 0.6 },
    { slopeAbove: 35, colour: [90, 90, 95] as [number, number, number], amount: 1 },
    { above: 300, slopeBelow: 20, colour: [250, 250, 255] as [number, number, number], amount: 0.3 },
  ];
  const w = new Wash({ base: [120, 100, 80], bands });
  const out = new Uint8Array(3);
  let right = true;
  let laid = [0, 0, 0];
  for (let i = 0; i < 2000; i++) {
    const elevation = (i * 13.7) % 900 - 100;
    const slope = (i * 3.1) % 80;
    w.colourAt(i, i, elevation, slope, out);
    let want = [120, 100, 80];
    bands.forEach((b, k) => {
      if ('above' in b && b.above !== undefined && elevation < b.above) return;
      if ('below' in b && b.below !== undefined && elevation > b.below) return;
      if ('slopeAbove' in b && b.slopeAbove !== undefined && slope < b.slopeAbove) return;
      if ('slopeBelow' in b && b.slopeBelow !== undefined && slope > b.slopeBelow) return;
      laid[k]++;
      want = want.map((o, c) => replace(o, b.colour[c], b.amount));
    });
    if (out[0] !== want[0] || out[1] !== want[1] || out[2] !== want[2]) right = false;
  }
  ok(right && laid.every((n) => n > 50), `each band is laid, in order, by replace-with-amount at its own amount exactly where its height and slope hold (laid ${laid.join(', ')} times of 2,000)`);
  laid = [0, 0, 0];
}

{
  // The reader.
  ok(typeof readWash({ base: [1, 2, 3] }) === 'object', 'a wash of a base alone reads');
  ok(typeof readWash({ base: [1, 2, 300] }) === 'string' && typeof readWash({ base: [1, 2, 3], glow: 1 }) === 'string' && typeof readWash({ base: [1, 2, 3], bands: [{ colour: [1, 2, 3], amount: 2 }] }) === 'string' && typeof readWash({ base: [1, 2, 3], noise: { scale: 0, amount: 0.1 } }) === 'string', 'a byte past 255, a field it does not read, an amount past 1 and a scale of nought are refused in words');
  const ok17 = readWash({ base: [1, 2, 3], bands: new Array(17).fill({ colour: [1, 2, 3], amount: 0.5 }) });
  ok(typeof ok17 === 'string', 'and so are more than sixteen bands');
}

const mon = PLANETS.find((p) => p.id === 'monument');
const rawDir = mon?.dem ? join(REPO, 'public', mon.dem.url.replace(/^\//, '')) : '';
if (!mon?.dem || !existsSync(join(rawDir, 'base16.raw'))) note('no Monument raster in this checkout: its half is skipped');
else {
  const d = mon.dem;
  const raw = readFileSync(join(rawDir, 'base16.raw'));
  const meta = JSON.parse(readFileSync(join(rawDir, 'base.json'), 'utf8'));
  const make = (): Terrain => {
    const t = new Terrain(mon);
    const patch = makeDemPatch(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer, meta, { size: d.size, lift: d.lift, feather: d.feather ?? 0 });
    t.demDetail = d.detail ?? 0;
    t.dem = patch;
    t.minH = patch.minHeight + patch.lift;
    t.maxH = patch.maxHeight + patch.lift;
    t.floor = t.minH - 30;
    t.demShader = new DemShader({ pack: 'test', fallback: 'base', rules: [] }, new Map([['base', 1]]), patch.lift, 4);
    t.tiler = { rank: (x: number) => x, layer: (x: number) => x, corners: [0, 1, 2, 3], census: new Float64Array(5), setWeights: () => {} } as unknown as ChunkTiler;
    return t;
  };
  // The noise, over a 64 m grid of the whole raster.
  const noisy = new Wash({ base: [128, 128, 128], noise: { scale: 400, amount: 0.15 } });
  const t = make();
  const half = d.size / 2;
  const out = new Uint8Array(3);
  let sum = 0;
  let count = 0;
  let lo = 255;
  let hi = 0;
  for (let z = -half; z <= half; z += 64) {
    for (let x = -half; x <= half; x += 64) {
      noisy.colourAt(-x, z, t.heightAt(x, z) - d.lift, 0, out);
      sum += out[0];
      count++;
      lo = Math.min(lo, out[0]);
      hi = Math.max(hi, out[0]);
    }
  }
  const mean = sum / count;
  ok(Math.abs(mean - 128) / 255 < 0.01 && hi - lo > 10, `the noise is centred on nought: over a 64 m grid of the whole raster (${count} places) its mean is ${mean.toFixed(2)} against a base of 128 (within a hundredth), varying from ${lo} to ${hi}`);
  // A chunk's colour bytes are the wash's at each sample.
  const wash = new Wash({ base: [150, 120, 90], bands: [{ above: 1500, colour: [230, 230, 235], amount: 0.7 }, { slopeAbove: 25, colour: [80, 70, 60], amount: 0.9 }], noise: { scale: 300, amount: 0.1 } });
  t.demWash = wash;
  let worst = 0;
  t.buildChunk(0, 0);
  let gridSame = true;
  let gridSamples = 0;
  for (let j = 1; j < CHUNK_RES; j += 3) {
    for (let i = 1; i < CHUNK_RES; i += 3) {
      const step = CHUNK_SIZE / CHUNK_RES;
      const x = i * step;
      const z = j * step;
      const got = t.colourIdAt(x, z);
      if (got < 0) continue;
      const h = t.heightAt(x, z);
      const dx = (t.heightAt(x + step, z) - t.heightAt(x - step, z)) / (2 * step);
      const dz = (t.heightAt(x, z + step) - t.heightAt(x, z - step)) / (2 * step);
      wash.colourAt(-x, z, h - d.lift, Math.atan(Math.sqrt(dx * dx + dz * dz)) * 57.29577951308232, out);
      const want = (out[0] << 16) | (out[1] << 8) | out[2];
      gridSamples++;
      if (got !== want) {
        gridSame = false;
        worst = Math.max(worst, Math.abs(((got >> 16) & 255) - out[0]));
      }
    }
  }
  ok(gridSame && gridSamples > 100, `a chunk drawn by the tile program carries the wash's colour at every sample (${gridSamples} poles read back), its height above sea level and its slope as the chunk's own grid has them${worst ? `; worst ${worst}` : ''}`);
  // Colour paint over it, with the wash and without: at game (x, z) the colour the paint lays at raw (-x, z) over the wash's.
  const paint = new GroundPaint();
  // Cells at raw x -4 to -28 only (game x 4 to 28), so a read unmirrored meets none of them.
  for (let cz = 0; cz <= 7; cz++) for (let cx = -7; cx <= -1; cx++) colourCell(paint, cx, cz, 30 + cx * 10 + 100, 200 - cz * 9, 90, 120 + cz * 15);
  t.demShader!.paint = paint;
  for (const washed of [true, false]) {
    t.demWash = washed ? wash : null;
    t.buildChunk(0, 0);
    let right = true;
    let reached = 0;
    let read = 0;
    for (let j = 1; j < CHUNK_RES; j += 1) {
      for (let i = 1; i < CHUNK_RES; i += 1) {
        const step = CHUNK_SIZE / CHUNK_RES;
        const x = i * step;
        const z = j * step;
        if (x > 40 || z > 40) continue;
        const got = t.colourIdAt(x, z);
        if (got < 0) continue;
        read++;
        out[0] = 255;
        out[1] = 255;
        out[2] = 255;
        if (washed) {
          const h = t.heightAt(x, z);
          const dx = (t.heightAt(x + step, z) - t.heightAt(x - step, z)) / (2 * step);
          const dz = (t.heightAt(x, z + step) - t.heightAt(x, z - step)) / (2 * step);
          wash.colourAt(-x, z, h - d.lift, Math.atan(Math.sqrt(dx * dx + dz * dz)) * 57.29577951308232, out);
        }
        if (paint.colourAtRaw(-x, z, out)) reached++;
        if (got !== ((out[0] << 16) | (out[1] << 8) | out[2])) right = false;
      }
    }
    ok(right && reached > 50 && read > reached, `${washed ? 'with' : 'without'} a wash, colour paint is laid at every sample as the paint lays it at the sample's raw place (game x mirrored) over ${washed ? "the wash's colour" : 'white'}: ${reached} of ${read} samples painted`);
  }
  t.demShader!.paint = null;
  // With no wash, white.
  t.demWash = null;
  const plain = t.buildChunk(0, 0);
  const tint = plain.geometry.getAttribute('aGroundTint') as THREE.BufferAttribute;
  let white = true;
  for (let i = 0; i < tint.array.length; i++) if (tint.array[i] !== 255) white = false;
  ok(white, 'with no wash every sample is white, as before');
}

console.log(`\ndemWash: ${checks} checks passed`);
