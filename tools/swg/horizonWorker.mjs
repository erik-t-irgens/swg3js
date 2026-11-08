// One thread of the far ground's bake (`horizon.mjs`): the world's terrain loaded once as the game loads it (its bitmaps,
// its colour ramps and every building layer the layout names, in the layout's order), then jobs of two kinds. A `fine`
// job is a row of squares of 2 m poles with four of margin, each run through the generator as the sampler makes a block,
// keeping the heights on the ground's lattice, the family at every 8 m pattern corner and each colour cell's mean of the
// colour map's linear interpolation (weights 1, 2, ..., 2, 1 over the cell's poles). A `coarse` job is a band of 64 m
// grids, keeping each sample's height, family and colour as the generator gives them there.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { attachBitmap, attachRamp, bitmapFiles, parseLayerFile, parseTerrainTemplate, rampNames, readColorRampFile, TerrainSampler } from '../../src/swg/terrain/trn.ts';
import { SQUARE, SQUARE_MARGIN, yawOf } from './horizon.mjs';

/** A pack's terrain made into a sampler with its building layers, as `world.ts` makes it at an arrival (no edits). */
export function loadBakeSampler(packDir) {
  const template = parseTerrainTemplate(new Uint8Array(readFileSync(join(packDir, 'terrain.trn'))));
  for (const b of bitmapFiles(template)) {
    const f = join(packDir, b.file);
    if (existsSync(f)) attachBitmap(template, b.familyId, new Uint8Array(readFileSync(f)));
  }
  const rf = join(packDir, 'terrain/colorramps.json');
  if (existsSync(rf)) {
    const ramps = readColorRampFile(JSON.parse(readFileSync(rf, 'utf8')));
    for (const n of rampNames(template)) {
      const r = ramps.get(n);
      if (r) attachRamp(template, n, r);
    }
  }
  const sampler = new TerrainSampler(template);
  const layout = JSON.parse(readFileSync(join(packDir, 'layout.json'), 'utf8'));
  for (const o of layout.objects ?? []) {
    if (!o.layer || o.contained) continue;
    const p = join(packDir, o.layer);
    if (!existsSync(p)) continue;
    const layer = parseLayerFile(new Uint8Array(readFileSync(p)), template.generator);
    if (layer) sampler.addBuildingLayer(layer, o.x, o.z, yawOf(o.q));
  }
  return sampler;
}

const mod = (v, m) => ((v % m) + m) % m;
const rowsIn = (lat, z0, z1) => [Math.max(0, Math.ceil((z0 - lat.z0) / lat.step)), Math.min(lat.nz, Math.ceil((z1 - lat.z0) / lat.step))];

function fineJob(s, job) {
  const { s0, squares, row, fine, ground, colour } = job;
  const step = 2;
  const m = SQUARE_MARGIN;
  const span = SQUARE * step;
  const n = SQUARE + 2 * m;
  const sz = s0 + row * span;
  const [hj0, hj1] = rowsIn(fine, sz, sz + span);
  const [gj0, gj1] = rowsIn(ground, sz, sz + span);
  const [cj0, cj1] = rowsIn(colour, sz, sz + span);
  const H = new Float32Array(Math.max(0, hj1 - hj0) * fine.nx);
  const F = new Uint8Array(Math.max(0, gj1 - gj0) * ground.nx);
  const C = new Uint8Array(Math.max(0, cj1 - cj0) * colour.nx * 3);
  let wide = 0;
  const W = colour.step;
  const half = W / 4;
  for (let c = 0; c < squares; c++) {
    const sx = s0 + c * span;
    const ox = sx - m * step;
    const oz = sz - m * step;
    const g = s.generate(ox, oz, n, step);
    const pole = (x, z) => ((z - oz) / step) * n + (x - ox) / step;
    for (let j = hj0; j < hj1; j++) {
      const z = fine.z0 + j * fine.step;
      for (let x = sx + mod(fine.x0 - sx, fine.step); x < sx + span; x += fine.step) {
        const i = Math.round((x - fine.x0) / fine.step);
        if (i < 0 || i >= fine.nx) continue;
        H[(j - hj0) * fine.nx + i] = g.heights[pole(x, z)];
      }
    }
    for (let j = gj0; j < gj1; j++) {
      const z = ground.z0 + j * 8;
      for (let x = sx + mod(ground.x0 - sx, 8); x < sx + span; x += 8) {
        const i = Math.round((x - ground.x0) / 8);
        if (i < 0 || i >= ground.nx) continue;
        const f = g.shaders[pole(x, z)];
        if (f > 255 || f < 0) wide++;
        F[(j - gj0) * ground.nx + i] = f > 255 || f < 0 ? 0 : f;
      }
    }
    for (let j = cj0; j < cj1; j++) {
      const z = colour.z0 + j * W;
      for (let x = sx + mod(colour.x0 - sx, W); x < sx + span; x += W) {
        const i = Math.round((x - colour.x0) / W);
        if (i < 0 || i >= colour.nx) continue;
        let r = 0;
        let gg = 0;
        let b = 0;
        for (let bz = -half; bz <= half; bz++) {
          const wz = bz === -half || bz === half ? 1 : 2;
          for (let ax = -half; ax <= half; ax++) {
            const w = wz * (ax === -half || ax === half ? 1 : 2);
            const k = pole(x + ax * 2, z + bz * 2) * 3;
            r += w * g.colors[k];
            gg += w * g.colors[k + 1];
            b += w * g.colors[k + 2];
          }
        }
        const o = ((j - cj0) * colour.nx + i) * 3;
        const d = W * W;
        C[o] = Math.round(r / d);
        C[o + 1] = Math.round(gg / d);
        C[o + 2] = Math.round(b / d);
      }
    }
  }
  return { kind: 'fine', hj0, gj0, cj0, H, F, C, wide };
}

function coarseJob(s, job) {
  const { coarse, j0, j1 } = job;
  const step = coarse.step;
  const m = 2;
  const g0 = 64;
  const rows = j1 - j0;
  const H = new Float32Array(rows * coarse.nx);
  const F = new Uint8Array(rows * coarse.nx);
  const C = new Uint8Array(rows * coarse.nx * 3);
  let wide = 0;
  const n = g0 + 2 * m;
  for (let i0 = 0; i0 < coarse.nx; i0 += g0) {
    const ox = coarse.x0 + (i0 - m) * step;
    const oz = coarse.z0 + (j0 - m) * step;
    const g = s.generate(ox, oz, n, step);
    for (let j = 0; j < rows; j++) {
      for (let i = i0; i < Math.min(coarse.nx, i0 + g0); i++) {
        const k = (j + m) * n + (i - i0 + m);
        const o = j * coarse.nx + i;
        H[o] = g.heights[k];
        const f = g.shaders[k];
        if (f > 255 || f < 0) wide++;
        F[o] = f > 255 || f < 0 ? 0 : f;
        C[o * 3] = g.colors[k * 3];
        C[o * 3 + 1] = g.colors[k * 3 + 1];
        C[o * 3 + 2] = g.colors[k * 3 + 2];
      }
    }
  }
  return { kind: 'coarse', j0, H, F, C, wide };
}

if (parentPort && workerData?.packDir) {
  const sampler = loadBakeSampler(workerData.packDir);
  parentPort.on('message', ({ i, job }) => {
    const t0 = performance.now();
    const r = job.kind === 'fine' ? fineJob(sampler, job) : coarseJob(sampler, job);
    r.i = i;
    r.ms = performance.now() - t0;
    parentPort.postMessage(r, [r.H.buffer, r.F.buffer, r.C.buffer]);
  });
  parentPort.postMessage({ ready: true });
}

export { fineJob, coarseJob };
