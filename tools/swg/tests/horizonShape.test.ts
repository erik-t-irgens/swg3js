// The rings' shape window (the horizon pass's wave 3b, `shapeWindow.ts`): the live generator's own 2 m heights round the
// eye. Held here: the window stands round the eye's block and a move hands each slot it leaves to the block now there,
// emptied and due on the card in that very frame (a far move: the whole block at once); blocks are taken from the near
// ground's cache first, the rest asked of the worker one at a time, nearest first, the next asked as each lands and an
// answer for a block the window has moved past dropped; the reader's bilinear and its own triangles hold the made samples
// and read none where one is not made. And over a converted world in node: a block taken from the near ground's cache and
// one made by the source's own path (the very grid the near ground asks the worker for, laid by the sampler's own rule)
// are the near ground's block's own poles to the bit, an owner's height edit laid over both.
//
// Run: node tools/swg/tests/horizonShape.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SHAPE_BLOCK, SHAPE_CACHE_PER_FRAME, SHAPE_EMPTY, SHAPE_SIDE, ShapeWindow, shapeSourceOf, shapeWindowReach, type ShapeSource } from '../../../src/world/horizon/shapeWindow.ts';
import { HORIZON_TUNE, HoleGrid, reachRules, newReachRules, shapeRanges, shapeReachMost } from '../../../src/world/horizon/horizonMath.ts';
import { HeightEdits } from '../../../src/swg/terrain/heightEdits.ts';
import { bakedWorlds, loadBaked, poleHeight } from './horizonWorld.ts';
import { HorizonField, RingSession, atlasLayout, heightsAtlas } from '../../../src/world/horizon/horizonField.ts';
import { SHAPE_REACH_MOST, tuneHorizon } from '../../../src/world/horizon/horizonDials.ts';
import { testCamera, testHole, testPyramid } from './horizonFixtures.ts';
import { TerrainSampler } from '../../../src/swg/terrain/trn.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// ---- the window, over a stand-in source whose heights are a function of the place
const H = (rx: number, rz: number) => 0.01 * rx - 0.02 * rz + Math.sin(rx * 0.3);
const blockOf = (bx: number, bz: number) => {
  const out = new Float32Array(SHAPE_BLOCK * SHAPE_BLOCK);
  for (let j = 0; j < SHAPE_BLOCK; j++) for (let i = 0; i < SHAPE_BLOCK; i++) out[j * SHAPE_BLOCK + i] = H(bx * 64 + i * 2, bz * 64 + j * 2);
  return out;
};
const cachedSet = new Set<string>();
let asks = 0;
let inFlight = 0;
let mostInFlight = 0;
const pending: { bx: number; bz: number; resolve: (h: Float32Array | null) => void }[] = [];
const asked: string[] = [];
const src: ShapeSource = {
  cached: (bx, bz, out) => {
    if (!cachedSet.has(`${bx},${bz}`)) return false;
    out.set(blockOf(bx, bz));
    return true;
  },
  make: (bx, bz) => {
    asks++;
    inFlight++;
    mostInFlight = Math.max(mostInFlight, inFlight);
    asked.push(`${bx},${bz}`);
    return new Promise((resolve) => pending.push({ bx, bz, resolve: (h) => (inFlight--, resolve(h)) }));
  },
};
const tick = () => new Promise((r) => setTimeout(r, 0));
const SIDE = 256; // 8 blocks a side: small enough to fill here
const w = new ShapeWindow(SIDE, 2);
w.source = src;
// The eye at raw (1000, -600): block (15, -10); the window from block (11, -14), eight blocks.
for (let bz = -14; bz < -6; bz++) for (let bx = 11; bx < 19; bx++) if (Math.abs(bx - 15) + Math.abs(bz + 10) <= 2) cachedSet.add(`${bx},${bz}`);
w.stepTo(1000, -600);
ok(w.placed && w.bx0 === 11 && w.bz0 === -14 && w.gi0 === 11 * 32 && w.gj0 === -14 * 32, `the window stands round the eye's block, its first sample the block's (${w.bx0}, ${w.bz0})`);
ok(w.whole && w.counts.cached === cachedSet.size && w.made === cachedSet.size, `the first frame takes every block the near ground holds from its cache (${w.counts.cached}) and the card's whole block is due`);
ok(asks === 1 && inFlight === 1 && asked[0] !== undefined, 'and asks the worker for one block, never more at once');
// The first asked is the nearest one not cached: one block from the eye's, by the spiral.
const [ax, az] = asked[0].split(',').map(Number);
ok(Math.abs(ax - 15) + Math.abs(az + 10) === 3 || (ax - 15) ** 2 + (az + 10) ** 2 <= 5, `the first block asked is among the nearest the cache had not (${asked[0]})`);
// Landing chains the next at once.
for (let k = 0; k < 70; k++) {
  const p = pending.shift();
  if (!p) break;
  p.resolve(blockOf(p.bx, p.bz));
  await tick();
}
ok(w.made === 64 && mostInFlight === 1 && pending.length === 0, `the worker makes the rest one at a time, each next asked as the last lands, with no frame between (${w.made} of 64 made, at most ${mostInFlight} out)`);
// Every made sample is the source's own, read back by the window's bilinear and its own triangles at the lattice.
let bad = 0;
for (let k = 0; k < 2000; k++) {
  const gi = w.gi0 + Math.floor(Math.random() * (SIDE - 1));
  const gj = w.gj0 + Math.floor(Math.random() * (SIDE - 1));
  const want = Math.fround(H(gi * 2, gj * 2));
  if (w.heightAt(gi * 2, gj * 2) !== want || w.surfaceAt(gi * 2, gj * 2) !== want) bad++;
}
ok(bad === 0, 'the window holds every made block\'s samples where the global index says, read back exactly at the lattice');
// Between samples, the patch's own diagonal (raw south-west to north-east) and the bilinear.
{
  const rx = (w.gi0 + 40) * 2 + 1.5;
  const rz = (w.gj0 + 40) * 2 + 0.5;
  const i = Math.floor(rx / 2);
  const j = Math.floor(rz / 2);
  const u = rx / 2 - i;
  const v = rz / 2 - j;
  const s = (a: number, b: number) => Math.fround(H(a * 2, b * 2));
  const tri = u >= v ? s(i, j) + u * (s(i + 1, j) - s(i, j)) + v * (s(i + 1, j + 1) - s(i + 1, j)) : s(i, j) + v * (s(i, j + 1) - s(i, j)) + u * (s(i + 1, j + 1) - s(i, j + 1));
  ok(Math.abs(w.surfaceAt(rx, rz) - tri) < 1e-9, 'its own triangles split from the raw south-west to the north-east, as the patch is');
  ok(Number.isNaN(w.heightAt(w.gi0 * 2 - 3, rz)) && Number.isNaN(w.surfaceAt((w.gi0 + SIDE) * 2, rz)), 'and it reads nothing past its own block');
}
// Dirty slots: taken one at a time, then none.
let taken = 0;
while (w.takeDirty() >= 0) taken++;
ok(taken === 64 - cachedSet.size || taken === 64, `every block made after the first frame is due on the card once (${taken})`);
// A one-block move: the column it leaves is handed to the blocks now there, emptied, due in this frame, and flagged.
w.whole = false;
asks = 0;
w.stepTo(1000 + 64, -600);
ok(w.bx0 === 12 && w.moved && !w.whole && w.dirty === 8, `a step of a block moves the window a block: the eight slots it hands on are emptied and due at once (${w.dirty})`);
ok(Number.isNaN(w.heightAt((19 * 32 + 3) * 2, -600)) && !Number.isNaN(w.heightAt((12 * 32 + 3) * 2, -600)), 'the new column reads nothing until made; the rest is kept');
ok(asks === 1, 'and the nearest of the new ones is asked of the worker');
// An answer for a block the window has moved past is dropped.
const stale = pending.shift()!;
w.stepTo(1000 + 64 * 12, -600);
ok(w.whole, 'a move of a quarter of the window or more sends the whole block at once');
const before = w.counts.dropped;
stale.resolve(blockOf(stale.bx, stale.bz));
await tick();
ok(w.counts.dropped === before + 1, 'an answer for a block the window has moved past is dropped, never put');
// A null (no worker now) leaves the block pending, asked again.
const p2 = pending.shift();
if (p2) {
  p2.resolve(null);
  await tick();
}
ok(w.counts.failed >= 1, 'a block the worker could not make is left to be asked again');
ok(SHAPE_CACHE_PER_FRAME > 0 && SHAPE_EMPTY < -1e29, 'the sentinel is past what the ring reads as a height');
w.dispose();

// ---- the ranges (`shapeRanges`): each coarser level's morph begins past the finer range by its gap
{
  const r = newReachRules();
  const saved = { ...HORIZON_TUNE };
  let worst = Infinity;
  for (const S of [200, 350, 500, 700, 900, 1200, 1500]) {
    for (const lodT of [1034, 1400, 1800]) {
      HORIZON_TUNE.shapeReach = S;
      shapeRanges(HORIZON_TUNE, lodT, true, r);
      const mf = HORIZON_TUNE.shapeMorph;
      const m = HORIZON_TUNE.morph;
      worst = Math.min(worst, r.r1 * (1 - mf) - r.r2 - HORIZON_TUNE.shapeGap * 32, r.lod0 * (1 - m) - r.r1 - HORIZON_TUNE.shapeGap * 64, r.lod0 - lodT);
    }
  }
  ok(worst >= -1e-9, "every coarser level's morph begins its gap of node sizes past the finer range, and level 0's range is never shorter than without the shape");
  HORIZON_TUNE.shapeReach = 0;
  shapeRanges(HORIZON_TUNE, 1400, true, r);
  ok(r.finest === 0 && r.lod0 === 1400, 'a reach of nought is the rings of before');
  HORIZON_TUNE.shapeReach = 700;
  shapeRanges(HORIZON_TUNE, 1400, false, r);
  ok(r.finest === 0 && r.lod0 === 1400, 'and so is a world with no shape window (the hatch, a world of other poles)');
  reachRules(HORIZON_TUNE, 6, true, r);
  ok(r.finest === -2 && r.r2 === 700, `on, the 2 m level holds to the reach and the 4 m level to ${Math.round(r.r1)} m, level 0 to ${Math.round(r.lod0)} m`);
  Object.assign(HORIZON_TUNE, saved);
}

// ---- over a converted world: the source's two paths are the near ground's block's own poles to the bit
const name = bakedWorlds()[0];
if (!name) console.log('note no baked world on disk: the source over a real terrain is left out');
else {
  const world = await loadBaked(name);
  if (!world) console.log(`note ${name} did not load: the source over a real terrain is left out`);
  else {
    const swg = world.swg;
    // An owner's edit over two blocks (a 64 m tile of 2 m deltas), laid by both paths as the near ground lays it.
    const edits = new HeightEdits();
    const d = new Float32Array(32 * 32);
    for (let k = 0; k < d.length; k++) d[k] = 3 + (k % 7) * 0.25;
    edits.set(2, 2, d);
    swg.sampler.heights = edits;
    const terrain = { sampler: swg.sampler, workerUp: true, generatePoles: (x: number, z: number, n: number, step: number) => Promise.resolve(swg.sampler.generate(x, z, n, step)) };
    const source = shapeSourceOf(terrain);
    let made = 0;
    let off = 0;
    let fromCache = 0;
    const out = new Float32Array(32 * 32);
    for (const [bx, bz] of [[2, 2], [3, 2], [-5, 7], [10, -3]]) {
      const h = await source.make(bx, bz);
      if (!h) continue;
      made++;
      // The near ground's own block (generated and laid as it enters the cache), its own poles.
      for (let j = 0; j < 32; j++) for (let i = 0; i < 32; i++) if (h[j * 32 + i] !== poleHeight(swg, bx * 64 + i * 2, bz * 64 + j * 2)) off++;
      if (source.cached(bx, bz, out)) {
        fromCache++;
        for (let k = 0; k < out.length; k++) if (out[k] !== h[k]) off++;
      }
    }
    ok(made === 4 && fromCache === 4 && off === 0, `${name}: a block made by the source's own path and one taken from the near ground's cache are its block's poles to the bit, the owner's edit laid over both (${made} blocks)`);
    const laid = poleHeight(swg, 2 * 64 + 6, 2 * 64 + 4) - (swg.sampler.rawPoleAt?.(2 * 64 + 6, 2 * 64 + 4) ?? Number.NaN);
    ok(Number.isNaN(laid) || Math.abs(laid - (3 + ((2 * 32 + 3) % 7) * 0.25)) < 1e-4, `and the edit is in it (${laid.toFixed(3)} m over the raw pole)`);
    const none = shapeSourceOf({ ...terrain, workerUp: false });
    ok(none.make(0, 0) === null, 'with no worker the source asks nothing (the main thread never generates a block for it)');
    swg.sampler.heights = null;
  }
}

// ---- the window's block in the heights atlas lands on none of the bake's samples, on every shape of world
{
  let bad = 0;
  let fineKept = true;
  for (const [fnx, fnz, cnx, cnz] of [[2049, 2049, 513, 513], [4097, 4097, 257, 257], [513, 513, 1025, 1025], [1025, 513, 300, 1100], [2049, 2049, 1500, 200]]) {
    const L = atlasLayout(fnx, fnz, cnx, cnz, 1024);
    const meets = (x0: number, y0: number, w: number, h: number) => L.col < x0 + w && L.col + 1024 > x0 && L.row < y0 + h && L.row + 1024 > y0;
    if (meets(0, 0, fnx, fnz) || meets(0, fnz, cnx, cnz) || L.col + 1024 > L.w || L.row + 1024 > L.h) bad++;
    // And the atlas laid with the window holds every fine and coarse sample where the atlas without it does (by row and column).
    const fine = new Float32Array(fnx * fnz).map((_, k) => k + 1);
    const coarse = new Float32Array(cnx * cnz).map((_, k) => -(k + 1));
    const a = heightsAtlas(fine, fnx, fnz, coarse, cnx, cnz, 1024);
    for (let j = 0; j < cnz && fineKept; j += 37) for (let i = 0; i < cnx; i++) if (a[(fnz + j) * L.w + i] !== coarse[j * cnx + i]) fineKept = false;
    for (let j = 0; j < fnz && fineKept; j += 41) for (let i = 0; i < fnx; i++) if (a[j * L.w + i] !== fine[j * fnx + i]) fineKept = false;
  }
  ok(bad === 0, "the shape window's block in the heights atlas meets neither the fine rows nor the coarse ones, and fits in it, on five shapes of world");
  ok(fineKept, 'and the atlas laid with it keeps every fine and coarse sample at its own row and column');
}

// ---- wave 3b's review: the finer ranges are held inside the window's whole share, the dial and the page stop where it holds
{
  const saved = { ...HORIZON_TUNE };
  const r = newReachRules();
  // The game's window, its share read by its own `ringHeight` (the vertex stage's arithmetic): a place is held whole exactly
  // where the bake under it moves nothing.
  const win = new ShapeWindow(SHAPE_SIDE, 2);
  win.source = { cached: (bx, bz, out) => (out.fill(100 + bx + bz * 0.5), true), make: () => null };
  const fillAt = (rx: number, rz: number) => {
    for (let k = 0; k < 40 && win.made < win.blocks * win.blocks; k++) win.stepTo(rx, rz);
  };
  let short = 0;
  let tried = 0;
  let worst = Infinity;
  for (const fade of [16, 1, 64]) {
    for (const finest of [2, 4]) {
      for (const S of [300, 700, 900, 1200, 1500]) {
        Object.assign(HORIZON_TUNE, { shapeFade: fade, shapeFinest: finest, shapeReach: S });
        shapeRanges(HORIZON_TUNE, 1400, true, r);
        // A finer vertex asks its level at d < r1 and its morph moves it at most one 4 m step.
        const reach = r.r1 + 4;
        // Eyes at both ends of a block each way: the window stands round the block, so its reach is least from its far edge.
        for (const [ex, ez] of [[64 * 7 + 0.01, -64 * 3 + 0.01], [64 * 8 - 0.01, -64 * 2 - 0.01]]) {
          fillAt(ex, ez);
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            tried++;
            const px = ex + dx * reach;
            const pz = ez + dz * reach;
            if (win.ringHeight(px, pz, 0, fade) !== win.ringHeight(px, pz, 1, fade)) short++;
          }
        }
        worst = Math.min(worst, shapeWindowReach(fade) - reach);
      }
    }
  }
  ok(short === 0 && worst >= 0, `every finer range, a morph step and all, stands where the window holds its heights whole, from an eye anywhere in its block, at three fades, both finest spacings and reaches to 1.5 km (${tried} places; the least room ${worst.toFixed(1)} m)`);
  Object.assign(HORIZON_TUNE, saved);
  ok(shapeWindowReach(16) === 926, `the window's whole share reaches ${shapeWindowReach(16)} m along an axis at the shipped fade`);
  HORIZON_TUNE.shapeReach = SHAPE_REACH_MOST;
  shapeRanges(HORIZON_TUNE, 1400, true, r);
  const menu = readFileSync(new URL('../../../src/ui/menu.ts', import.meta.url), 'utf8');
  const page = /key: 'terrainShapeDetail'[^\n]*?max: ([\d.]+)/.exec(menu);
  ok(r.finest === -2 && r.r2 === SHAPE_REACH_MOST && SHAPE_REACH_MOST <= shapeReachMost(HORIZON_TUNE) && page !== null && Math.round(Number(page[1]) * 1000) === SHAPE_REACH_MOST, `the dial and the Graphics page stop at ${SHAPE_REACH_MOST} m (page ${page?.[1]} km), which the ranges keep whole (the most kept ${shapeReachMost(HORIZON_TUNE).toFixed(1)} m)`);
  // The morph share and the fade the program reads: held where the ranges are placed, by the tune and in the uniforms.
  const said = tuneHorizon({ shapeMorph: 5, shapeFade: 0, shapeReach: 1500 });
  ok(HORIZON_TUNE.shapeMorph === 0.9 && HORIZON_TUNE.shapeFade === 1 && HORIZON_TUNE.shapeReach === SHAPE_REACH_MOST && said.some((s) => s.includes('shapeReach held')), `tuneHorizon holds the morph share to 0.9, the fade to a sample at the least and the reach where the window holds, and says so (${said.join('; ')})`);
  Object.assign(HORIZON_TUNE, saved);
  win.dispose();
}

// ---- wave 3b's review: the sampler's cache by block number (the window's probe builds no key) is kept wherever a block
// enters or leaves the cache: the real methods, on a stand-in of the sampler's own fields (no generator needed).
{
  const NP = 36;
  const s = Object.create(TerrainSampler.prototype) as TerrainSampler;
  Object.assign(s, { blocks: new Map(), byNumber: new Map(), raws: new Map(), previewBase: new Map(), relayWait: new Map(), heights: null, course: null, numberOfPoles: NP, blockWidth: 64, poleStep: 2, lastBx: Number.NaN, lastBz: Number.NaN, lastBlock: undefined });
  const block = (v: number) => ({ heights: new Float32Array(NP * NP).fill(v) }) as never;
  const out = new Float32Array(SHAPE_BLOCK * SHAPE_BLOCK);
  const has = (bx: number, bz: number) => s.copyInnerHeights(bx, bz, out);
  s.putBlock(3, -2, block(7));
  const put = has(3, -2) && out[0] === 7 && out[1023] === 7;
  s.forgetBlock(3, -2);
  const forgot = !has(3, -2);
  s.putBlock(3, -2, block(8));
  s.putBlock(40, 40, block(9));
  s.evict(40, 40, 2);
  const evicted = !has(3, -2) && has(40, 40) && out[5] === 9;
  s.invalidateAll();
  const cleared = !has(40, 40);
  ok(put && forgot && evicted && cleared, `the window's probe finds a block the worker put in the cache, and none once it is forgotten, evicted or the cache cleared (${[put, forgot, evicted, cleared].join(', ')})`);
}

// ---- wave 3b's review: the far cards stand on what the ring draws (its level's lattice, the window's heights), and are
// stood again when the window comes whole or the ranges move
{
  const saved = { ...HORIZON_TUNE };
  HORIZON_TUNE.drop = 0;
  const field = new HorizonField('cards', { x: 0, z: 0 }, { x: 0, z: 0 });
  const flat = (x0: number, step: number, n: number) => ({ x0, z0: x0, step, nx: n, nz: n, h: new Float32Array(n * n) });
  Object.assign(field.surface, { fine: flat(-2048, 8, 513), coarse: flat(-16384, 64, 513), cx: 0, cz: 0, sx: 0, sz: 0 });
  // The window's heights: a slope with a 4 m and an 8 m ripple the bake (flat at nought) does not carry, so a 2 m vertex, a
  // 4 m edge's middle and an 8 m edge's middle each read differently from the coarser lattice's.
  const G = (rx: number, rz: number) => 0.01 * rx + 0.02 * rz + 1.5 * Math.cos((Math.PI * rx) / 2) + 0.7 * Math.cos((Math.PI * rx) / 4);
  const cw = new ShapeWindow(512, 2);
  cw.source = {
    cached: (bx, bz, out) => {
      for (let j = 0; j < SHAPE_BLOCK; j++) for (let i = 0; i < SHAPE_BLOCK; i++) out[j * SHAPE_BLOCK + i] = G(bx * 64 + i * 2, bz * 64 + j * 2);
      return true;
    },
    make: () => null,
  };
  (field as unknown as { shape: ShapeWindow }).shape = cw;
  Object.assign(field.rules, { finest: -2, r2: 100, r1: 200, lod0: 1400, mf: 0.15 });
  Object.assign(field.ask, { ex: 0, ey: 0, ez: 0 });
  ok(field.shapeMoved(), 'shapeMoved: the first ask after the ranges are set says the cards must be stood again');
  ok(!field.shapeMoved(), 'and the same again says nothing');
  for (let k = 0; k < 20 && cw.made < cw.blocks * cw.blocks; k++) cw.stepTo(0, 0);
  ok(field.shapeMoved() && !field.shapeMoved(), 'the window come whole (an arrival, a teleport, a move\'s new blocks) stands them again, once');
  // Along the raw lattice line z = 0, in the game's frame (raw x = -gx): a 2 m vertex where the 2 m level is drawn, a 4 m
  // edge's middle where the 4 m level is, an 8 m edge's middle past r1, each by the eye's distance.
  const f = (rx: number) => Math.fround(G(rx, 0));
  const at = (rx: number) => field.surfaceAt(-rx, 0, 0, 0, 6);
  const e2 = Math.abs(at(50) - f(50));
  const e4 = Math.abs(at(150) - (f(148) + f(152)) / 2);
  const e8 = Math.abs(at(300) - (f(296) + f(304)) / 2);
  ok(e2 < 1e-4 && e4 < 1e-4 && e8 < 1e-4, `the cards stand on the ring's own lattice by the eye's distance: a 2 m vertex at 50 m, a 4 m edge's middle at 150 m, the window's 8 m edge's middle at 300 m, past the 4 m range (off by ${e2.toExponential(1)}, ${e4.toExponential(1)}, ${e8.toExponential(1)} m)`);
  ok(Math.abs(at(150) - f(150)) > 1 && Math.abs(at(300)) > 1, "and never the 2 m surface where the 4 m level is drawn, nor the bake where the window holds the 8 m level's vertices");
  field.rules.r1 = 250;
  ok(field.shapeMoved(), 'the ranges moved (the Terrain shape detail) stand them again');
  HORIZON_TUNE.shapeFade = 8;
  ok(field.shapeMoved(), "and so does the window's fade");
  cw.forget();
  ok(!field.shapeMoved(), 'a window let go (a late heights file) waits for its blocks');
  for (let k = 0; k < 20 && cw.made < cw.blocks * cw.blocks; k++) cw.stepTo(0, 0);
  ok(field.shapeMoved(), 'and stands them again once they are made');
  // The morph share and the fade the program reads come from the ranges and are held there, whatever the tune was set to by
  // hand: the frame's own uniforms, written by the field's own update.
  HORIZON_TUNE.shapeMorph = 3;
  HORIZON_TUNE.shapeFade = 0;
  field.pyramid = testPyramid(24000, { x: 0, z: 0 });
  const session = new RingSession(null);
  const hole = new HoleGrid();
  testHole(hole, 0, 0, 6);
  const cam = testCamera();
  cam.position.set(0, 30, 0);
  cam.updateMatrixWorld();
  field.update(session, cam, cam.position, 6, 0, 0, hole, true);
  const ua = session.uniforms.uHorizonShapeAt.value;
  ok(ua.w === 0.9 && ua.z === 1 && field.rules.mf === 0.9, `the program morphs by the share the ranges were placed with (${ua.w}) and divides by a fade of a sample at the least (${ua.z})`);
  Object.assign(HORIZON_TUNE, saved);
  cw.dispose();
}

console.log(`\nhorizonShape: ${checks} checks passed`);
