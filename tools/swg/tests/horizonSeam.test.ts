// The seam the near ground hands over to the rings at (the horizon pass's third wave, the owner's 2026-11-08 additions):
// inside the ground detail distance the rings draw the near ground's own composition from the composition window, so on
// every baked world on disk the window's tiles (worked out by the decode worker from the bake's pattern corners and the
// place's hash) must be the tiles the near ground's chunk builder works out from the live generator's own blocks, to the
// layer and the mask code, and the tint the rings read between the bake's colour cells must stand near the colour map the
// near ground reads at its 2 m poles. The tiler is a stand-in on both sides (the rule is `tileLayers`, the tile program's
// own); the worlds are the packs' own (`SWG3JS_PACKS`, else `assets-private`), and a world not on disk is a note.
//
// Run: node tools/swg/tests/horizonSeam.test.ts
import assert from 'node:assert/strict';
import { tileLayers, type GroundTiler } from '../../../src/world/groundTiles.ts';
import { TileComposer, normalsOf, unpackWindow, windowRect, type TileTables } from '../../../src/world/horizon/horizonDecode.ts';
import { bakedWorlds, loadBaked } from './horizonWorld.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const worlds = bakedWorlds(['tatooine', 'naboo']).slice(0, 2);
if (!worlds.length) console.log('note no baked world on disk: the seam is not checked here (npm run swg -- horizon assets-private --only=tatooine)');
for (const name of worlds) {
  const w = await loadBaked(name);
  if (!w) {
    console.log(`note ${name}'s bake does not read here`);
    continue;
  }
  // A stand-in tiler both sides share: a family's rank its id, a layer the family and the choice folded into a byte.
  const tiler: GroundTiler = { rank: (f) => f, layer: (f, c) => (f * 7 + c) & 255, corners: [0, 1, 2, 3] };
  const layerOf = new Uint8Array(256 * 256);
  const rankOf = new Float64Array(256);
  for (let f = 0; f < 256; f++) {
    rankOf[f] = f;
    for (let c = 0; c < 256; c++) layerOf[f * 256 + c] = tiler.layer(f, c);
  }
  const t: TileTables = { layerOf, rankOf, corners: [0, 1, 2, 3], means: new Float32Array(768), masks: new Uint8Array(3), ms: 1, tintMode: 1, gainCap: 1, reference: null, add: false, painted: true };
  const comp = new TileComposer(t, w.families, w.header.ground);
  const s = w.swg.sampler;
  const bw = s.blockWidth;
  const step = s.poleStep;
  const fams = new Int32Array(4);
  const choices = new Int32Array(4);
  const layers = new Uint8Array(4);
  const codes = new Uint8Array(3);
  const got = [0, 0, 0, 0];
  const gotCodes = [0, 0, 0];
  const g = w.header.ground;
  const col = w.header.colour;
  let seed = 77;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  let tiles = 0;
  let wrong = 0;
  let multi = 0;
  const diffs: number[] = [];
  let poles = 0;
  let grain = 0;
  const OFFS = [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5], [0.5, 0.5]];
  const offSum = OFFS.map(() => 0);
  const fineN = normalsOf(w.fine, w.header.fine);
  let leanSum = 0;
  let leanN = 0;
  for (let k = 0; k < 48; k++) {
    // A block well inside the map, where the near ground stands.
    const rx = g.x0 + 512 + rnd() * ((g.nx - 1) * g.step - 1024);
    const rz = g.z0 + 512 + rnd() * ((g.nz - 1) * g.step - 1024);
    const bx = Math.floor(rx / bw);
    const bz = Math.floor(rz / bw);
    const b = s.generateBlock(bx, bz);
    const st = s.blockStart(bx, bz);
    const N = s.numberOfPoles;
    const at = (x: number, z: number) => Math.round((z - st.z) / step) * N + Math.round((x - st.x) / step);
    // Every 4 m tile whose corners lie in the block: the chunk builder's rule over the live poles, against the window's.
    const tx0 = Math.ceil(st.x / 4);
    const tz0 = Math.ceil(st.z / 4);
    const tx1 = Math.floor((st.x + (N - 1) * step) / 4) - 1;
    const tz1 = Math.floor((st.z + (N - 1) * step) / 4) - 1;
    const r = { x0: tx0, z0: tz0, w: tx1 - tx0 + 1, h: tz1 - tz0 + 1 };
    const win = windowRect(comp, r);
    for (let tz = tz0; tz <= tz1; tz++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const x = tx * 4;
        const z = tz * 4;
        const c = [at(x, z), at(x + 4, z), at(x, z + 4), at(x + 4, z + 4)];
        for (let q = 0; q < 4; q++) {
          fams[q] = b.shaders[c[q]] & 255;
          choices[q] = b.children[c[q]];
        }
        const count = tileLayers(fams, choices, tiler, layers, codes);
        const n2 = unpackWindow(win, ((tz - tz0) * r.w + (tx - tx0)) * 4, got, gotCodes);
        tiles++;
        if (count > 1) multi++;
        if (n2 !== count || got.some((v, q) => v !== layers[q]) || gotCodes.some((v, q) => v !== codes[q])) {
          if (!wrong) console.log(`  first differing tile on ${name} at raw ${x},${z}: window ${got}/${gotCodes}/${n2}, near ground ${[...layers]}/${[...codes]}/${count}`);
          wrong++;
        }
      }
    }
    // The tint: each 2 m pole's colour-map bytes against the bilinear between the bake's colour cells there (the program's
    // `ringWindowAt`: cell centres at the colour lattice's own samples), and against the same read half a cell off each way.
    for (let j = 1; j < N - 1; j += 1) {
      for (let i = 1; i < N - 1; i += 1) {
        const x = st.x + i * step;
        const z = st.z + j * step;
        for (let o = 0; o < OFFS.length; o++) {
          const u = (x - col.x0) / col.step + OFFS[o][0];
          const v = (z - col.z0) / col.step + OFFS[o][1];
          const iu = Math.floor(u);
          const iv = Math.floor(v);
          if (iu < 0 || iv < 0 || iu + 1 >= col.nx || iv + 1 >= col.nz) continue;
          const fu = u - iu;
          const fv = v - iv;
          for (let ch = 0; ch < 3; ch++) {
            const c00 = w.colour[(iv * col.nx + iu) * 3 + ch];
            const c10 = w.colour[(iv * col.nx + iu + 1) * 3 + ch];
            const c01 = w.colour[((iv + 1) * col.nx + iu) * 3 + ch];
            const c11 = w.colour[((iv + 1) * col.nx + iu + 1) * 3 + ch];
            const lerp = (c00 * (1 - fu) + c10 * fu) * (1 - fv) + (c01 * (1 - fu) + c11 * fu) * fv;
            const d = Math.abs(lerp - b.colors[(j * N + i) * 3 + ch]);
            if (o === 0) diffs.push(d);
            offSum[o] += d;
          }
        }
        // The lean: the near ground's vertex normal (central differences one 2 m step either side, `terrain.ts`'s) against the
        // ring's baked normal there (the bake's 8 m lattice, normalsOf's arithmetic, bilinear), as an angle.
        {
          const dxr = (b.heights[j * N + i + 1] - b.heights[j * N + i - 1]) / (2 * step);
          const dzr = (b.heights[(j + 1) * N + i] - b.heights[(j - 1) * N + i]) / (2 * step);
          const ln = Math.hypot(dxr, 1, dzr);
          const fu = (x - w.header.fine.x0) / w.header.fine.step;
          const fv = (z - w.header.fine.z0) / w.header.fine.step;
          const iu = Math.floor(fu);
          const iv = Math.floor(fv);
          if (iu >= 0 && iv >= 0 && iu + 1 < w.header.fine.nx && iv + 1 < w.header.fine.nz) {
            const nx = w.header.fine.nx;
            const at = (a: number, c: number, k: number) => (fineN[(c * nx + a) * 2 + k] - 127.5) / 127.5;
            const lerp = (k: number) => (at(iu, iv, k) * (1 - (fu - iu)) + at(iu + 1, iv, k) * (fu - iu)) * (1 - (fv - iv)) + (at(iu, iv + 1, k) * (1 - (fu - iu)) + at(iu + 1, iv + 1, k) * (fu - iu)) * (fv - iv);
            const bx = lerp(0);
            const bz = lerp(1);
            const by = Math.sqrt(Math.max(0, 1 - bx * bx - bz * bz));
            const bl = Math.hypot(bx, by, bz);
            const cos = (dxr / ln) * (bx / bl) + (1 / ln) * (by / bl) + (-dzr / ln) * (bz / bl);
            leanSum += Math.acos(Math.min(1, cos)) * (180 / Math.PI);
            leanN++;
          }
        }
        // The colour map's own 2 m grain: a pole against the mean of the nine round it.
        for (let ch = 0; ch < 3; ch++) {
          let m = 0;
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) m += b.colors[((j + dj) * N + i + di) * 3 + ch];
          grain += Math.abs(b.colors[(j * N + i) * 3 + ch] - m / 9);
        }
        poles++;
      }
    }
  }
  ok(tiles > 10000 && multi > 0 && wrong === 0, `${name}: the composition window's every tile is the near ground's own (layers, alternates, mask codes, count) over ${tiles} tiles of 48 blocks (${multi} of two families or more)`);
  diffs.sort((a, b) => a - b);
  const mean = diffs.reduce((a, b) => a + b, 0) / Math.max(1, diffs.length);
  const p99 = diffs[Math.floor(diffs.length * 0.99)] ?? 0;
  console.log(`note ${name}: the tint the rings read (the bilinear between the bake's 8 m colour cells) against the near ground's 2 m poles, ${poles} poles: mean ${mean.toFixed(2)}, 99th percentile ${p99.toFixed(1)} levels of 255; the colour map's own 2 m grain (a pole against its nine) ${(grain / (poles * 3)).toFixed(2)}: what an 8 m cell cannot carry`);
  console.log(`note ${name}: the near ground's 2 m lean against the ring's 8 m baked lean at the same poles: ${(leanSum / Math.max(1, leanN)).toFixed(2)} degrees on average over ${leanN} poles (the bumps, the same either side, ride on both)`);
  // The cells read where the program reads them: half a cell off any way reads worse (a frame or an offset wrong would read best there).
  const at0 = offSum[0];
  ok(OFFS.every((_o, k) => k === 0 || offSum[k] > at0), `${name}: the tint read between the cells' own centres meets the near ground's better than half a cell off any way (${OFFS.map((o, k) => `${o.join(',')} ${(offSum[k] / (poles * 3)).toFixed(2)}`).join('; ')})`);
}

console.log(`\nhorizonSeam: ${checks} checks passed`);
