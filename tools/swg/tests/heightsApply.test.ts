// The ground's height edits laid where a generated grid enters a cache (Map-maker II, DESIGN.md §2.4), on the real
// `SwgTerrain` over converted worlds in node (no worker here, so the main thread's path; the worker's by handing `putBlock`
// the worker core's own answer). After fifty random strokes with evictions between them: outside every tile every pole is
// the generator's to the bit and inside it is `fround(raw + d)`; both copies of every edge pole (one block's pad, the next
// one's own) are the same bits; a far grid's samples are laid alike, each the block's pole under it; and an undo (every
// tile let go) returns every block and far grid to its bits before.
//
// Run: node tools/swg/tests/heightsApply.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SwgTerrain } from '../../../src/world/swgTerrain.ts';
import { HEIGHT_POLE, HEIGHT_TILE_POLES, HeightEdits } from '../../../src/swg/terrain/heightEdits.ts';
import { bitmapFiles, TerrainSampler, type PoleBlock } from '../../../src/swg/terrain/trn.ts';
import { TerrainWorkerCore } from '../../../src/swg/terrain/workerCore.ts';
import { groundChunkOrigin } from '../../../src/world/groundTiles.ts';
import { groundWorlds, PACKS } from './terrainHarness.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);

/** A seeded generator (the tests' own), so a failure is the same strokes again. */
function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function centreOf(world: string): { x: number; z: number } | null {
  const file = join(PACKS, world, 'layout.json');
  if (!existsSync(file)) return null;
  const m = /"center"\s*:\s*\{\s*"x"\s*:\s*(-?[\d.]+)\s*,\s*"z"\s*:\s*(-?[\d.]+)/.exec(readFileSync(file, 'utf8').slice(0, 8000));
  return m ? { x: Number(m[1]), z: Number(m[2]) } : null;
}

const all = groundWorlds();
const worlds = ['tatooine', 'naboo', 'corellia'].filter((w) => all.includes(w));
if (!worlds.length && all.length) worlds.push(all[0]);
if (!worlds.length) note(`no converted worlds under ${PACKS}: nothing here can be checked without them`);

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
  const store = new HeightEdits();
  const sw = await SwgTerrain.create(trn, [], c.x, c.z, async (f) => bytes(f), { heights: store });
  const s = sw.sampler;
  // The generator's own ground, beside it, from the same template: what every pole is held to.
  const rawS = new TerrainSampler(sw.template);
  const bw = s.blockWidth;
  const np = s.numberOfPoles;
  const step = s.poleStep;
  const start = (b: number) => b * bw - 2 * step;
  const r = rand(7);
  // An area of 6 x 6 blocks round the raw origin, its blocks cached and some evicted as the strokes go.
  const B0 = -3;
  const B1 = 2;
  const cache = () => {
    for (let bz = B0; bz <= B1; bz++) for (let bx = B0; bx <= B1; bx++) s.generateBlock(bx, bz);
  };
  cache();
  for (let k = 0; k < 50; k++) {
    // A stroke: a bump of random height over a random disc, written into the store's tiles, then laid again.
    const cx = (r() - 0.5) * 300;
    const cz = (r() - 0.5) * 300;
    const R = 6 + r() * 50;
    const amp = (r() - 0.5) * 20;
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let pz = Math.ceil((cz - R) / HEIGHT_POLE); pz <= Math.floor((cz + R) / HEIGHT_POLE); pz++) {
      for (let px = Math.ceil((cx - R) / HEIGHT_POLE); px <= Math.floor((cx + R) / HEIGHT_POLE); px++) {
        const d = Math.hypot(px * 2 - cx, pz * 2 - cz);
        if (d > R) continue;
        const tx = Math.floor(px / HEIGHT_TILE_POLES);
        const tz = Math.floor(pz / HEIGHT_TILE_POLES);
        const t = store.writable(tx, tz)!;
        const i = (pz - tz * HEIGHT_TILE_POLES) * HEIGHT_TILE_POLES + (px - tx * HEIGHT_TILE_POLES);
        t[i] = Math.fround(t[i] + amp * (1 - d / R));
        x0 = Math.min(x0, px * 2);
        x1 = Math.max(x1, px * 2);
        z0 = Math.min(z0, pz * 2);
        z1 = Math.max(z1, pz * 2);
      }
    }
    if (x0 <= x1) sw.relayRect(sw.toGameX(x1), sw.toGameZ(z0), sw.toGameX(x0), sw.toGameZ(z1));
    // Some blocks evicted between strokes (the far side of the area from a random block), and the area made again.
    if (k % 7 === 3) s.evict(B0 + Math.floor(r() * 6), B0 + Math.floor(r() * 6), 1);
    if (k % 7 === 5) cache();
  }
  cache();
  // Every pole: raw outside every tile, fround(raw + d) inside.
  let bad = '';
  let laid = 0;
  for (let bz = B0; bz <= B1; bz++) {
    for (let bx = B0; bx <= B1; bx++) {
      const b = s.generateBlock(bx, bz);
      const raw = rawS.generateBlock(bx, bz);
      for (let j = 0; j < np; j++) {
        for (let i = 0; i < np; i++) {
          const k = j * np + i;
          const px = (start(bx) + i * step) / HEIGHT_POLE;
          const pz = (start(bz) + j * step) / HEIGHT_POLE;
          const d = store.poleDelta(px, pz);
          const want = d !== 0 ? Math.fround(raw.heights[k] + d) : raw.heights[k];
          if (d !== 0) laid++;
          if (!Object.is(b.heights[k], want)) bad ||= `block ${bx},${bz} pole ${i},${j}`;
        }
      }
    }
  }
  ok(!bad && laid > 1000, `${world}: after fifty strokes with evictions, every pole of 36 blocks is the generator's outside every tile and fround(raw + d) inside (${laid} poles laid)${bad ? `; first apart: ${bad}` : ''}`);
  // Both copies of every edge pole agree.
  let edges = 0;
  let apart = '';
  const heightAtPole = (b: PoleBlock, bx: number, bz: number, x: number, z: number) => b.heights[((z - start(bz)) / step) * np + (x - start(bx)) / step];
  for (let bz = B0; bz <= B1; bz++) {
    for (let bx = B0; bx < B1; bx++) {
      const a = s.generateBlock(bx, bz);
      const n = s.generateBlock(bx + 1, bz);
      for (let x = start(bx + 1); x <= start(bx) + (np - 1) * step; x += step) {
        for (let z = start(bz); z <= start(bz) + (np - 1) * step; z += step) {
          edges++;
          if (!Object.is(heightAtPole(a, bx, bz, x, z), heightAtPole(n, bx + 1, bz, x, z))) apart ||= `${x},${z}`;
        }
      }
    }
  }
  ok(!apart && edges > 0, `${world}: both copies of every shared pole of neighbouring blocks are the same bits (${edges} poles)${apart ? `; first apart at ${apart}` : ''}`);
  // A far grid laid alike, each sample the block's pole under it.
  // The far tile the raw origin lies in, on the near ground's own lattice (its samples on poles).
  const o = groundChunkOrigin(Math.floor(sw.toGameX(0) / 512), Math.floor(sw.toGameZ(0) / 512), sw.groundShift, 512);
  const g = sw.farGrid(o.x, o.z, 512, 32, true)!;
  const fn = 35;
  let farBad = '';
  let farLaid = 0;
  for (let j = 0; j < fn; j++) {
    for (let i = 0; i < fn; i++) {
      // Column i is raw x = startX + (n - 1 - i) step, row j raw z = startZ + j step (the far grid's own layout).
      const gx = o.x + (i - 1) * 16;
      const gz = o.z + (j - 1) * 16;
      const x = sw.toSwgX(gx);
      const z = sw.toSwgZ(gz);
      const bx = Math.floor(x / bw);
      const bz = Math.floor(z / bw);
      if (bx < B0 || bx > B1 || bz < B0 || bz > B1) continue;
      if (store.poleDelta(x / 2, z / 2) !== 0) farLaid++;
      const b = s.generateBlock(bx, bz);
      if (!Object.is(g.heights[j * fn + i], heightAtPole(b, bx, bz, x, z))) farBad ||= `${gx},${gz}`;
    }
  }
  ok(!farBad && farLaid > 0, `${world}: a far grid's samples over the area are the blocks' poles under them, laid alike (${farLaid} laid)${farBad ? `; first apart at ${farBad}` : ''}`);
  // The worker's path: a block the worker core made, handed to putBlock, takes the edits as it lands.
  const core = new TerrainWorkerCore();
  const bitmaps: { familyId: number; bytes: ArrayBuffer }[] = [];
  for (const bm of bitmapFiles(sw.template)) {
    const b = bytes(bm.file);
    if (b) bitmaps.push({ familyId: bm.familyId, bytes: b });
  }
  core.handle({ type: 'init', trn, layers: [], bitmaps });
  s.evict(100, 100, 0);
  const rep = core.handle({ type: 'generate', id: 1, startX: start(0), startZ: start(0), n: np, step }).message as unknown as PoleBlock;
  s.putBlock(0, 0, { heights: rep.heights, shaders: rep.shaders, children: rep.children, colors: rep.colors, excluded: rep.excluded, floraCollidable: rep.floraCollidable, floraNonCollidable: rep.floraNonCollidable, radialNear: rep.radialNear, radialFar: rep.radialFar, environments: rep.environments, seasonal: rep.seasonal });
  const put = s.generateBlock(0, 0);
  const raw0 = rawS.generateBlock(0, 0);
  let workerBad = false;
  for (let k = 0; k < put.heights.length; k++) {
    const i = k % np;
    const j = Math.floor(k / np);
    const d = store.poleDelta((start(0) + i * step) / 2, (start(0) + j * step) / 2);
    if (!Object.is(put.heights[k], d !== 0 ? Math.fround(raw0.heights[k] + d) : raw0.heights[k])) workerBad = true;
  }
  ok(!workerBad, `${world}: a block the worker made, handed to putBlock, takes the edits as it lands`);
  // An undo: every tile let go, every block and far grid laid again from raw, the generator's bits.
  store.clear();
  sw.useHeights(store);
  let back = '';
  for (let bz = B0; bz <= B1; bz++) for (let bx = B0; bx <= B1; bx++) for (let k = 0; k < np * np; k++) if (!Object.is(s.generateBlock(bx, bz).heights[k], rawS.generateBlock(bx, bz).heights[k])) back ||= `${bx},${bz}`;
  const rawG = new HeightEdits();
  void rawG;
  ok(!back, `${world}: every tile let go, every block is the generator's bits again${back ? `; first apart at ${back}` : ''}`);
  let farBack = true;
  for (let j = 0; j < fn; j++)
    for (let i = 0; i < fn; i++) {
      const gx = o.x + (i - 1) * 16;
      const gz = o.z + (j - 1) * 16;
      const x = sw.toSwgX(gx);
      const z = sw.toSwgZ(gz);
      const bx = Math.floor(x / bw);
      const bz = Math.floor(z / bw);
      if (bx < B0 || bx > B1 || bz < B0 || bz > B1) continue;
      if (!Object.is(g.heights[j * fn + i], heightAtPole(rawS.generateBlock(bx, bz), bx, bz, x, z))) farBack = false;
    }
  ok(farBack, `${world}: and the far grid's samples are the generator's poles again`);
}

console.log(`\nheightsApply: ${checks} checks passed`);
