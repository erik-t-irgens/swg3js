// The far ground's bake against the near ground (the horizon pass's first wave, DESIGN.md §2.2, §3), over the packs on
// disk (`SWG3JS_PACKS`, else `assets-private`), on every world that has a bake: the header read back; the heights within
// half the section's 16-bit step of the game's own `generateBlock` at every pole of 120 sampled blocks a world on the
// ground's lattice (the building layers applied as `world.ts` applies them), and the decoder's float32 exactly
// `lo + q * stored`; the families at every pattern corner of them and the colour means against the blocks' own weighted
// poles; the game's far grids' samples (`SwgTerrain.farGrid`, in node with no worker) within half a step; the coarse
// heights equal to the fine at every shared sample. And over every terrain on disk, baked or not, the two facts the bake
// rests on: no active height affector under a layer whose filters read the normals or the families, and every painted
// pole's choice its place's own hash. A world with no bake is a note; either fact failing names the terrain.
//
// Run: node tools/swg/tests/horizonBake.test.ts
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childChoiceAt, GENERATOR_REVISION } from '../../../src/swg/terrain/generator.ts';
import { parseTerrainTemplate } from '../../../src/swg/terrain/trn.ts';
import { HORIZON_BIN, HORIZON_JSON, decodeHeights, decodeSteps, readHorizonHeader, type HorizonHeader } from '../../../src/world/horizon/horizonFile.ts';
import { inflateSections } from '../../../src/world/horizon/horizonDecode.ts';
import { loadBakeSampler } from '../horizonWorker.mjs';
import { yawOf } from '../horizon.mjs';
import { SwgTerrain } from '../../../src/world/swgTerrain.ts';
import { PLANETS } from '../../../src/data/planets.ts';

/** The developer worlds (PlanetDef.extra): never offered, baked only by hand; a fact failing there is said, not asserted. */
const EXTRA = new Set(PLANETS.filter((p) => p.extra).flatMap((p) => [p.id, ...(p.zones ?? []).map((z) => z.pack)]));

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const packs = process.env.SWG3JS_PACKS || join(repo, 'assets-private');
const worlds = existsSync(packs) ? readdirSync(packs).filter((w) => existsSync(join(packs, w, 'terrain.trn'))) : [];
let seed = 31337;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const mod = (v: number, m: number) => ((v % m) + m) % m;

// ---- the two facts, over every terrain on disk
let gated = 0;
const gatedNames: string[] = [];
for (const w of worlds) {
  let template;
  try {
    template = parseTerrainTemplate(new Uint8Array(readFileSync(join(packs, w, 'terrain.trn'))));
  } catch {
    continue;
  }
  const walk = (layers: { active: boolean; filters?: { active: boolean; needsNormals(): boolean; needsShaders(): boolean }[]; affectors?: { active: boolean; affectsHeight(): boolean }[]; layers?: unknown[] }[], filtered: boolean): void => {
    for (const l of layers) {
      if (!l.active) continue;
      const fs = (l.filters ?? []).filter((f) => f.active);
      const f = filtered || fs.some((x) => x.needsNormals() || x.needsShaders());
      const n = (l.affectors ?? []).filter((a) => a.active && a.affectsHeight()).length;
      if (n && f) {
        gated += n;
        if (!gatedNames.includes(w)) gatedNames.push(w);
      }
      walk((l.layers ?? []) as never, f);
    }
  };
  walk(template.generator.layers as never, false);
}
ok(worlds.length === 0 || gated === 0, `no active height affector stands under a layer whose filters read the normals or the families, over ${worlds.length} terrains on disk${gatedNames.length ? ` (${gatedNames.join(', ')})` : ''}`);

let choiceBad = 0;
let choicePoles = 0;
const extraBad: string[] = [];
const badNames: string[] = [];
const baked: string[] = [];
for (const w of worlds) {
  const dir = join(packs, w);
  const hasBake = existsSync(join(dir, HORIZON_JSON)) && existsSync(join(dir, HORIZON_BIN));
  if (hasBake) baked.push(w);
  if (!existsSync(join(dir, 'layout.json'))) continue;
  let s;
  try {
    s = loadBakeSampler(dir);
  } catch {
    continue;
  }
  const half = s.template.mapWidthInMeters / 2;
  const blocks = hasBake ? 120 : 2;
  const header: HorizonHeader | null = hasBake ? ((r) => ('header' in r ? r.header : null))(readHorizonHeader(JSON.parse(readFileSync(join(dir, HORIZON_JSON), 'utf8')), { generator: GENERATOR_REVISION, centre: JSON.parse(readFileSync(join(dir, 'layout.json'), 'utf8')).center }, w)) : null;
  let dec: { fine: Float32Array; steps: Uint16Array; fam: Uint8Array; col: Uint8Array; coarse: Float32Array } | null = null;
  if (header) {
    const sec = await inflateSections(header, new Uint8Array(readFileSync(join(dir, HORIZON_BIN))));
    dec = { fine: decodeHeights(sec.heights, header.fine.nx, header.fine.nz, header.fine.lo, header.fine.q), steps: decodeSteps(sec.heights, header.fine.nx, header.fine.nz), fam: sec.families, col: sec.colour, coarse: decodeHeights(sec.coarseHeights, header.coarse.nx, header.coarse.nz, header.coarse.lo, header.coarse.q) };
  }
  let hN = 0;
  let hBad = 0;
  let fN = 0;
  let fBad = 0;
  let cN = 0;
  let cBad = 0;
  for (let b = 0; b < blocks; b++) {
    const bx = Math.floor(((rnd() * 1.8 - 0.9) * half) / s.blockWidth);
    const bz = Math.floor(((rnd() * 1.8 - 0.9) * half) / s.blockWidth);
    s.invalidateAll();
    const blk = s.generateBlock(bx, bz);
    const st = s.blockStart(bx, bz);
    const np = s.numberOfPoles;
    for (let j = 2; j < np - 2; j++) {
      for (let i = 2; i < np - 2; i++) {
        const x = st.x + i * s.poleStep;
        const z = st.z + j * s.poleStep;
        const k = j * np + i;
        if (blk.shaders[k] > 0) {
          choicePoles++;
          if (blk.children[k] !== childChoiceAt(x, z)) {
            if (EXTRA.has(w)) {
              if (!extraBad.includes(w)) extraBad.push(w);
            } else {
              choiceBad++;
              if (!badNames.includes(w)) badNames.push(w);
            }
          }
        }
        if (!header || !dec) continue;
        const f = header.fine;
        if (!mod(x - f.x0, f.step) && !mod(z - f.z0, f.step)) {
          const fi = (x - f.x0) / f.step;
          const fj = (z - f.z0) / f.step;
          if (fi >= 0 && fj >= 0 && fi < f.nx && fj < f.nz) {
            hN++;
            const fk = fj * f.nx + fi;
            if (!(Math.abs(dec.fine[fk] - blk.heights[k]) <= f.q / 2 + 1e-4) || dec.fine[fk] !== Math.fround(f.lo + f.q * dec.steps[fk])) hBad++;
          }
        }
        const g = header.ground;
        if (!mod(x, 8) && !mod(z, 8)) {
          const gi = (x - g.x0) / 8;
          const gj = (z - g.z0) / 8;
          if (gi >= 0 && gj >= 0 && gi < g.nx && gj < g.nz) {
            fN++;
            const want = blk.shaders[k] > 255 || blk.shaders[k] < 0 ? 0 : blk.shaders[k];
            if (dec.fam[gj * g.nx + gi] !== want) fBad++;
          }
          const c = header.colour;
          const W = c.step;
          if (!mod(x - c.x0, W) && !mod(z - c.z0, W) && i >= 2 + W / 4 && j >= 2 + W / 4 && i < np - 2 - W / 4 && j < np - 2 - W / 4) {
            const ci = (x - c.x0) / W;
            const cj = (z - c.z0) / W;
            if (ci >= 0 && cj >= 0 && ci < c.nx && cj < c.nz) {
              cN++;
              const sum = [0, 0, 0];
              const h = W / 4;
              for (let bz2 = -h; bz2 <= h; bz2++) {
                for (let ax = -h; ax <= h; ax++) {
                  const wgt = (bz2 === -h || bz2 === h ? 1 : 2) * (ax === -h || ax === h ? 1 : 2);
                  const kk = ((j + bz2) * np + i + ax) * 3;
                  for (let q = 0; q < 3; q++) sum[q] += wgt * blk.colors[kk + q];
                }
              }
              for (let q = 0; q < 3; q++) if (Math.round(sum[q] / (W * W)) !== dec.col[(cj * c.nx + ci) * 3 + q]) cBad++;
            }
          }
        }
      }
    }
  }
  if (!header || !dec) continue;
  ok(hN > 1000 && hBad === 0, `${w}: the heights within half a step (${(header.fine.q * 100).toFixed(2)} cm) of the game's own blocks at ${hN} poles of 120 blocks, the decoder exactly lo + q * stored`);
  ok(fN > 1000 && fBad === 0, `${w}: the families at ${fN} pattern corners the blocks' own`);
  ok(cN > 100 && cBad === 0, `${w}: the colour means at ${cN} cells the blocks' own weighted poles`);
  // The coarse heights at every sample they share with the fine.
  const f = header.fine;
  const co = header.coarse;
  let sN = 0;
  let sBad = 0;
  for (let cj = 0; cj < co.nz; cj++) {
    for (let ci = 0; ci < co.nx; ci++) {
      const fi = (co.x0 + ci * co.step - f.x0) / f.step;
      const fj = (co.z0 + cj * co.step - f.z0) / f.step;
      if (fi < 0 || fj < 0 || fi >= f.nx || fj >= f.nz || fi % 1 || fj % 1) continue;
      sN++;
      if (!(Math.abs(dec.coarse[cj * co.nx + ci] - dec.fine[fj * f.nx + fi]) <= (f.q + co.q) / 2 + 1e-4)) sBad++;
    }
  }
  ok(sN > 1000 && sBad === 0, `${w}: the coarse heights equal the fine at all ${sN} samples they share (within both steps)`);
  // The game's far grids, made in node with no worker: each sample a bake sample within half a step.
  const layout = JSON.parse(readFileSync(join(dir, 'layout.json'), 'utf8'));
  const layers: { bytes: ArrayBuffer; x: number; z: number; yaw: number }[] = [];
  for (const o of layout.objects ?? []) {
    if (!o.layer || o.contained || !existsSync(join(dir, o.layer))) continue;
    const bytes = readFileSync(join(dir, o.layer));
    layers.push({ bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), x: o.x, z: o.z, yaw: yawOf(o.q) });
  }
  const trn = readFileSync(join(dir, 'terrain.trn'));
  const swg = await SwgTerrain.create(trn.buffer.slice(trn.byteOffset, trn.byteOffset + trn.byteLength), layers, layout.center.x, layout.center.z, async (file) => {
    const p = join(dir, file);
    if (!existsSync(p)) return null;
    const b = readFileSync(p);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  });
  let gN = 0;
  let gBad = 0;
  for (let tIdx = 0; tIdx < 6; tIdx++) {
    const tx = Math.floor((rnd() * 2 - 1) * 8);
    const tz = Math.floor((rnd() * 2 - 1) * 8);
    const sh = swg.groundShift;
    const gx0 = tx * 512 + sh.x;
    const gz0 = tz * 512 + sh.z;
    const grid = swg.farGrid(gx0, gz0, 512, 32, true);
    if (!grid) continue;
    const nn = 35;
    for (let jj = 0; jj < nn; jj++) {
      for (let ii = 0; ii < nn; ii++) {
        const rx = layout.center.x - (gx0 + (ii - 1) * 16);
        const rz = gz0 + (jj - 1) * 16 + layout.center.z;
        const fi = (rx - f.x0) / f.step;
        const fj = (rz - f.z0) / f.step;
        if (fi < 0 || fj < 0 || fi >= f.nx || fj >= f.nz || fi % 1 || fj % 1) continue;
        gN++;
        if (!(Math.abs(grid.heights[jj * nn + ii] - dec.fine[fj * f.nx + fi]) <= f.q / 2 + 1e-4)) gBad++;
      }
    }
  }
  ok(gN > 1000 && gBad === 0, `${w}: every far-grid sample (${gN} of six far grids) is a bake sample within half a step`);
}
ok(choicePoles > 1000 && choiceBad === 0, `every painted pole's choice is its place's own hash (${choicePoles} poles of the sampled blocks over ${worlds.length} terrains${badNames.length ? `; not on ${badNames.join(', ')}` : ''})`);
if (extraBad.length) console.log(`note a developer world (never offered) has painted poles whose choice is not the hash, so its bake would want a choice section (format 2): ${extraBad.join(', ')}`);
if (!baked.length) console.log(`note no world under ${packs} has a far-ground bake: only the two facts were checked`);
else console.log(`note baked: ${baked.join(', ')}`);

console.log(`\nhorizonBake: ${checks} checks passed`);
