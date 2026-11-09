// The horizon pass's second wave: what the browser lays over its copy of the bake (DESIGN.md §2.3, §4 Tests). The heights:
// three ways for the store (none, empty, every value nought) the bake to the bit; deltas laid `fround(raw + d)` at every
// sample; a course carved by the race drawer's own far-grid rule at half the bake's step (4 m), tile by tile the same as
// over the whole lattice at once; a late file the same as one laid at an arrival, and a store emptied the bake again. The
// normals and the pyramid made again over the laid tiles alone the very bytes `normalsOf` and `pyramidOf` make of the laid
// heights. The albedo: a region composed with poles made again from the bake's own corners the whole composition's bytes,
// a region over a painted family section the composition of that section ("the composition's mirror"), a coarse region
// the whole coarse composition's; `overridesOf` over a grid takes each 4 m pole's family and choice and each cell's mean by
// the converter's own weights. On a baked world on disk (Tatooine first): the field's laid heights against the game's own
// laid blocks within half the section's step at every shared pole, three store ways and a raise; and the live generator's
// grid made into overrides the bake's own corners, choices and colour cells where nothing is painted.
//
// Run: node tools/swg/tests/horizonOverlay.test.ts
import assert from 'node:assert/strict';
import { CourseCarve, carveAsk } from '../../../src/swg/terrain/courseCarve.ts';
import { HeightEdits } from '../../../src/swg/terrain/heightEdits.ts';
import { childChoiceAt } from '../../../src/swg/terrain/generator.ts';
import { coarseAlbedoRegion, coarseReach, composeAlbedo, composeAlbedoRegion, composeCoarseAlbedo, normalsOf, normalsRect, poleFamily, pyramidOf, pyramidRelay, type PoleOverride, type TileTables } from '../../../src/world/horizon/horizonDecode.ts';
import type { HeightLattice, HorizonHeader } from '../../../src/world/horizon/horizonFile.ts';
import { HeightOverlay, layerExtent, overridesOf, paintRegenAsks, regenPlan, samplesIn, seasonalExtents } from '../../../src/world/horizon/horizonOverlay.ts';
import { HorizonField, type PoleGenerate } from '../../../src/world/horizon/horizonField.ts';
import { TERRAIN_GROUND_TUNE } from '../../../src/swg/terrain/generator.ts';
import { PAINT_TILE, paintTileNumber } from '../../../src/swg/terrain/groundPaint.ts';
import { TerrainSampler, parseLayerFile, parseTerrainTemplate } from '../../../src/swg/terrain/trn.ts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { straight } from './carveFixtures.ts';
import { rolling } from './horizonFixtures.ts';
import { bakedWorlds, loadBaked, packs, poleHeight } from './horizonWorld.ts';
import { yawOf } from '../horizon.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);
let seed = 909;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

// ---- the heights, on a lattice of the bake's shape (raw x0 even, 8 m, tiles cut at its edge)
const lat: HeightLattice = { x0: -2000, z0: -1600, step: 8, nx: 300, nz: 260, lo: 0, q: 1 };
const raw = new Float32Array(lat.nx * lat.nz);
for (let j = 0; j < lat.nz; j++) for (let i = 0; i < lat.nx; i++) raw[j * lat.nx + i] = Math.fround(rolling(lat.x0 + i * 8, lat.z0 + j * 8) + 0.123);
const same = (a: Float32Array, b: Float32Array) => a.length === b.length && a.every((v, k) => Object.is(v, b[k]));

const noughts = new HeightEdits();
const empty = new HeightEdits();
for (let tz = -20; tz < -10; tz++) for (let tx = -25; tx < -15; tx++) noughts.set(tx, tz, new Float32Array(1024));
for (const [name, store] of [['none', null], ['empty', empty], ['every value nought', noughts]] as const) {
  const f = raw.slice();
  const o = new HeightOverlay(lat);
  o.layAll(f, store, null);
  ok(same(f, raw), `the store ${name}: every sample the bake's to the bit`);
}
// Deltas over a few height tiles (64 m each), some reaching across a horizon tile's edge.
const edits = new HeightEdits();
for (let k = 0; k < 6; k++) {
  const d = new Float32Array(1024);
  for (let i = 0; i < d.length; i++) d[i] = Math.fround((rnd() - 0.4) * 9);
  edits.set(-27 + k * 3, -22 + (k % 2) * 5, d);
}
const laid = raw.slice();
const over = new HeightOverlay(lat);
const rects = over.layAll(laid, edits, null);
let dBad = 0;
let dMoved = 0;
for (let j = 0; j < lat.nz; j++) {
  for (let i = 0; i < lat.nx; i++) {
    const k = j * lat.nx + i;
    const d = edits.poleDelta(Math.round((lat.x0 + i * 8) / 2), Math.round((lat.z0 + j * 8) / 2));
    const want = d !== 0 ? Math.fround(raw[k] + d) : raw[k];
    if (d !== 0) dMoved++;
    if (!Object.is(laid[k], want)) dBad++;
  }
}
ok(dMoved > 300 && dBad === 0, `deltas laid fround(raw + d) at every sample (${dMoved} moved), and the rest the bake's to the bit (${rects.length} tiles laid)`);
// The normals and the pyramid over the laid tiles alone: the whole functions' bytes of the laid heights.
const n0 = normalsOf(raw, lat);
for (const r of rects) normalsRect(laid, lat, r.i0 - 1, r.j0 - 1, r.i1 + 1, r.j1 + 1, n0);
const nAll = normalsOf(laid, lat);
ok(n0.every((v, k) => v === nAll[k]), "the normals made again over each laid tile and a sample round it are normalsOf's of the laid heights, byte for byte");
const hdr = { fine: lat, coarse: { x0: lat.x0 - 64 * 40, z0: lat.z0 - 64 * 40, step: 64, nx: 118, nz: 113, lo: 0, q: 1 }, ground: { x0: -2000, z0: -1600, step: 8, nx: 300, nz: 260 }, colour: { x0: -2000, z0: -1600, step: 8, nx: 300, nz: 260 } } as unknown as HorizonHeader;
const coarse = new Float32Array(118 * 113);
for (let j = 0; j < 113; j++) for (let i = 0; i < 118; i++) coarse[j * 118 + i] = Math.fround(rolling(hdr.coarse.x0 + i * 64, hdr.coarse.z0 + j * 64));
const centre = { x: 1270, z: -333 };
const shift = { x: 1, z: 0 };
const pyr = pyramidOf(hdr, raw, coarse, centre, shift);
for (const r of rects) pyramidRelay(pyr, hdr, laid, coarse, centre, centre.x - (lat.x0 + r.i1 * 8), lat.z0 + r.j0 * 8 - centre.z, centre.x - (lat.x0 + r.i0 * 8), lat.z0 + r.j1 * 8 - centre.z);
const pyrAll = pyramidOf(hdr, laid, coarse, centre, shift);
let pBad = 0;
for (let L = 0; L < pyr.levels; L++) for (let k = 0; k < pyr.lo[L].length; k++) if (!Object.is(pyr.lo[L][k], pyrAll.lo[L][k]) || !Object.is(pyr.hi[L][k], pyrAll.hi[L][k])) pBad++;
ok(pBad === 0, "the pyramid made again over the laid tiles' leaves and every level above is pyramidOf's of the laid heights, to the bit");
// A late file: another store laid over the first, the same as it laid from scratch; emptied, the bake again.
const late = new HeightEdits();
const dl = new Float32Array(1024).fill(3.5);
late.set(-24, -21, dl);
over.layAll(laid, late, null);
const fresh = raw.slice();
new HeightOverlay(lat).layAll(fresh, late, null);
ok(same(laid, fresh), 'a store landed late over one laid at an arrival is the late store laid from raw, to the bit');
over.layAll(laid, null, null);
ok(same(laid, raw) && over.kept === 0, 'and with the store let go every tile is the bake again and no raw copy is kept');
// A course: the race drawer's own far-grid rule at half the bake's step, over the whole lattice at once, then the edits.
const course = new CourseCarve();
course.set([straight('h2', -1700, -900, -1300, 25, { w: 6, sh: 6 }), straight('h2b', -1600, -1000, -1050, -10, { w: 3, sh: 4 })]);
const carved = raw.slice();
const co2 = new HeightOverlay(lat);
co2.layAll(carved, edits, course);
const whole = new Float32Array(raw.length);
const ka = carveAsk();
ka.raw = raw;
ka.out = whole;
ka.x0 = lat.x0;
ka.dx = 8;
ka.z0 = lat.z0;
ka.dz = 8;
ka.nx = lat.nx;
ka.nz = lat.nz;
ka.widen = 4;
course.layIn(ka);
edits.lay(whole, whole, lat.x0, 8, lat.z0, 8, lat.nx, lat.nz);
ok(same(carved, whole), 'a course carved tile by tile (the far-grid rule at 4 m) then the edits over it is the same over the whole lattice at once, to the bit');
let roadMoved = 0;
for (let k = 0; k < raw.length; k++) if (carved[k] !== raw[k]) roadMoved++;
ok(roadMoved > 200, `and the course moved the ground (${roadMoved} samples), the 3 m road held on the 8 m samples by the widening`);

// ---- W2's review: a dropped building's ground made again through the field's own `regenerate` (heights true), from a
// stand-in of the live generator's 2 m grid, with a heights file landing while the generator works: the setRaw lambda's
// 2 m-to-8 m indexing, the stores read when the lay is made (the world hands the terrain itself), and the raw kept for good.
{
  const field = new HorizonField('test', centre, shift);
  const fine = raw.slice();
  Object.assign(field as unknown as Record<string, unknown>, { header: hdr, fineH: fine, coarseH: coarse, state: { state: 'ready' } });
  // The terrain's own shape: its `heights` replaced by a late file (`useHeights`), never mutated in place.
  const terrain = { heights: null as HeightEdits | null, course: null as CourseCarve | null };
  field.layHeights(terrain);
  const lateFile = new HeightEdits();
  lateFile.set(-23, -18, new Float32Array(1024).fill(1.25));
  lateFile.set(-30, -10, new Float32Array(1024).fill(-2));
  const fresh2 = (x: number, z: number) => Math.fround(700 + x * 0.01 - z * 0.02);
  const ask = { x0: -1500, z0: -1200, x1: -1400, z1: -1100, heights: true };
  let step = 0;
  const gen: PoleGenerate = async (sx, sz, n, st) => {
    step = st;
    const heights = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = fresh2(sx + i * st, sz + j * st);
    // The heights file lands while the generator works.
    terrain.heights = lateFile;
    return { heights, shaders: new Int32Array(n * n), children: new Uint8Array(n * n), colors: new Uint8Array(n * n * 3) };
  };
  await field.regenerate([ask], gen, terrain);
  const inRect = samplesIn(lat, ask)!;
  let bad = 0;
  let madeAgain = 0;
  let lateLaid = 0;
  for (let j = 0; j < lat.nz; j++) for (let i = 0; i < lat.nx; i++) {
    const k = j * lat.nx + i;
    const x = lat.x0 + i * 8;
    const z = lat.z0 + j * 8;
    const inside = i >= inRect.i0 && i <= inRect.i1 && j >= inRect.j0 && j <= inRect.j1;
    const base = inside ? fresh2(x, z) : raw[k];
    const d = lateFile.poleDelta(Math.round(x / 2), Math.round(z / 2));
    const want = d !== 0 ? Math.fround(base + d) : base;
    if (inside) madeAgain++;
    if (d !== 0) lateLaid++;
    if (!Object.is(fine[k], want)) bad++;
  }
  ok(step === 2 && madeAgain > 100 && lateLaid > 100 && bad === 0, `regenerate with heights: every fine sample in the rectangle the 2 m grid's own pole (${madeAgain}), the heights file that landed meanwhile laid over it and elsewhere (${lateLaid}), the rest the bake's to the bit`);
  // The raw made again is kept for good: the store let go puts the rectangle back to the generator's ground, never the bake's.
  terrain.heights = null;
  field.layHeights(terrain);
  let pinBad = 0;
  for (let j = inRect.j0; j <= inRect.j1; j++) for (let i = inRect.i0; i <= inRect.i1; i++) if (!Object.is(fine[j * lat.nx + i], fresh2(lat.x0 + i * 8, lat.z0 + j * 8))) pinBad++;
  ok(pinBad === 0 && field.rawTilesKept > 0, `and with the store let go the rectangle stays the generator's ground (its tiles' raw kept, ${field.rawTilesKept})`);
}

// ---- W2's review: the paint asks one function makes for an arrival and a file landed late
{
  const fam = new Map<number, unknown>([[paintTileNumber(2, -1), 1], [paintTileNumber(-3, 4), 1]]);
  const col = new Map<number, unknown>([[paintTileNumber(2, -1), 1], [paintTileNumber(0, 0), 1]]);
  const a = paintRegenAsks({ fam, col } as never);
  const want = [[2, -1], [-3, 4], [0, 0]].map(([tx, tz]) => ({ x0: tx * PAINT_TILE, z0: tz * PAINT_TILE, x1: (tx + 1) * PAINT_TILE, z1: (tz + 1) * PAINT_TILE, heights: false }));
  ok(JSON.stringify(a) === JSON.stringify(want), "paintRegenAsks: every painted 512 m tile once, families' and colours' alike, its heights not moved");
}

// ---- the albedo: a stand-in world as `horizonCompose.test.ts` builds it
const ms = 32;
const masks = new Uint8Array(ms * ms * 3);
for (let y = 0; y < ms; y++) {
  for (let x = 0; x < ms; x++) {
    const u = (x + 0.5) / ms;
    const v = (y + 0.5) / ms;
    const s = (t: number) => Math.min(1, Math.max(0, t));
    masks[y * ms + x] = Math.round(255 * s((0.75 - u) * 3.2) * s((0.75 - v) * 3.2));
    masks[ms * ms + y * ms + x] = Math.round(255 * s((0.6 - u) * 4));
    masks[2 * ms * ms + y * ms + x] = Math.round(255 * (1 - s((u - 0.4) * 4) * s((v - 0.4) * 4)));
  }
}
const F = 6;
const layerOf = new Uint8Array(256 * 256);
const rankOf = new Float64Array(256);
for (let f = 1; f <= F + 1; f++) {
  rankOf[f] = (f * 37) % 11;
  for (let c = 0; c < 256; c++) layerOf[f * 256 + c] = (f - 1) * 3 + (c % 3);
}
const means = new Float32Array(256 * 3);
for (let l = 0; l < (F + 1) * 3; l++) for (let k = 0; k < 3; k++) means[l * 3 + k] = 0.05 + 0.4 * rnd();
const t: TileTables = { layerOf, rankOf, corners: [0, 1, 2, 3], means, masks, ms, tintMode: 2, gainCap: 1.6, reference: { rgb: [0.55, 0.5, 0.45], luminance: 0.5 }, add: false, painted: true };
const n = 120;
const ground = { x0: -640, z0: -640, step: 8, nx: n, nz: n };
const fam = new Uint8Array(n * n);
for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) fam[j * n + i] = 1 + (Math.floor(i / 5 + Math.sin(j * 0.21) * 3) + Math.floor(j / 7)) % F;
const colour = new Uint8Array(n * n * 3);
for (let k = 0; k < colour.length; k++) colour[k] = 120 + Math.floor(120 * rnd());
const H = { fine: { x0: -640, z0: -640, step: 8, nx: n, nz: n, lo: 0, q: 1 }, ground, colour: { x0: -640, z0: -640, step: 8, nx: n, nz: n }, coarse: { x0: -640 - 64 * 3, z0: -640 - 64 * 3, step: 64, nx: 22, nz: 22, lo: 0, q: 1 }, sections: [], format: 1, source: {} } as unknown as HorizonHeader;
const full = composeAlbedo(t, H, fam, colour).rgba;
const region = (i0: number, j0: number, i1: number, j1: number, rgba: Uint8Array, w: number) => {
  let bad = 0;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) for (let c = 0; c < 4; c++) if (rgba[((j - j0) * w + (i - i0)) * 4 + c] !== full[(j * n + i) * 4 + c]) bad++;
  return bad;
};
const plain = composeAlbedoRegion(t, H, fam, colour, [], [], 20, 30, 60, 70);
ok(region(20, 30, 60, 70, plain.rgba, plain.w) === 0, "a region composed with nothing laid over is the whole composition's bytes");
// Poles made again from the bake's own corners and hash: the same bytes.
const poleSet = (x0: number, z0: number, pn: number, pm: number, famAt: (x: number, z: number) => number): PoleOverride => {
  const f = new Uint8Array(pn * pm);
  const c = new Uint8Array(pn * pm);
  for (let b = 0; b < pm; b++) for (let a = 0; a < pn; a++) {
    f[b * pn + a] = famAt(x0 + a * 4, z0 + b * 4);
    c[b * pn + a] = childChoiceAt(x0 + a * 4, z0 + b * 4);
  }
  return { x0, z0, n: pn, m: pm, fam: f, choice: c };
};
const own = poleSet(-640 + 20 * 8 - 4, -640 + 30 * 8 - 4, 41 * 2 + 1, 41 * 2 + 1, (x, z) => poleFamily(fam, ground, x, z));
const same1 = composeAlbedoRegion(t, H, fam, colour, [own], [], 20, 30, 60, 70);
ok(region(20, 30, 60, 70, same1.rgba, same1.w) === 0, "poles made again from the bake's own corners and the place's hash compose the same bytes");
// A painted family section: its own composition against the region composed with its poles laid over the unpainted section.
const painted = fam.slice();
for (let j = 40; j < 52; j++) for (let i = 30; i < 47; i++) painted[j * n + i] = F + 1;
const fullP = composeAlbedo(t, H, painted, colour).rgba;
const ovP = poleSet(-640 + 25 * 8 - 4, -640 + 35 * 8 - 4, 30 * 2 + 1, 25 * 2 + 1, (x, z) => poleFamily(painted, ground, x, z));
const rp = composeAlbedoRegion(t, H, fam, colour, [ovP], [], 25, 35, 54, 59);
let mBad = 0;
let changed = 0;
for (let j = 35; j <= 59; j++) for (let i = 25; i <= 54; i++) for (let c = 0; c < 4; c++) {
  const a = rp.rgba[((j - 35) * rp.w + (i - 25)) * 4 + c];
  if (a !== fullP[(j * n + i) * 4 + c]) mBad++;
  if (fullP[(j * n + i) * 4 + c] !== full[(j * n + i) * 4 + c]) changed++;
}
ok(changed > 100 && mBad === 0, `a painted region's albedo is the composition of the painted section (the composition's mirror), byte for byte (${changed} bytes moved by the paint)`);
// Colour cells laid over: a cell's tint from its own bytes.
const cells = { i0: 70, j0: 70, w: 4, h: 3, rgb: new Uint8Array(4 * 3 * 3).fill(200) };
const colourP = colour.slice();
for (let j = 70; j < 73; j++) for (let i = 70; i < 74; i++) colourP.fill(200, (j * n + i) * 3, (j * n + i) * 3 + 3);
const fullC = composeAlbedo(t, H, fam, colourP).rgba;
const rc = composeAlbedoRegion(t, H, fam, colour, [], [cells], 68, 68, 76, 76);
let cBad = 0;
for (let j = 68; j <= 76; j++) for (let i = 68; i <= 76; i++) for (let c = 0; c < 4; c++) if (rc.rgba[((j - 68) * rc.w + (i - 68)) * 4 + c] !== fullC[(j * n + i) * 4 + c]) cBad++;
ok(cBad === 0, "colour cells laid over tint as the composition of the recoloured section, byte for byte");
// The coarse texels a change reaches: the whole coarse composition's.
const cf = new Uint8Array(22 * 22).fill(2);
const cc = new Uint8Array(22 * 22 * 3).fill(150);
const coarseFull = composeCoarseAlbedo(t, H, fullP, cf, cc);
const r = coarseReach(H, 25, 35, 54, 59);
const fineR = composeAlbedoRegion(t, H, fam, colour, [ovP], [], Math.min(25, r.fi0), Math.min(35, r.fj0), Math.max(54, r.fi1), Math.max(59, r.fj1));
const coarseR = coarseAlbedoRegion(t, H, fineR, cf, cc, r.ci0, r.cj0, r.ci1, r.cj1);
let kBad = 0;
for (let j = 0; j < coarseR.h; j++) for (let i = 0; i < coarseR.w; i++) for (let c = 0; c < 4; c++) if (coarseR.rgba[(j * coarseR.w + i) * 4 + c] !== coarseFull[((r.cj0 + j) * 22 + r.ci0 + i) * 4 + c]) kBad++;
ok(coarseR.w * coarseR.h >= 4 && kBad === 0, `the coarse texels the change reaches (${coarseR.w} by ${coarseR.h}) are the whole coarse composition's of the painted albedo`);
// overridesOf over a hand-made grid: each 4 m pole's family (a family past a byte nought) and choice, each cell's mean.
const plan = regenPlan(H.colour, { x0: -400, z0: -300, x1: -380, z1: -284 }, 0)!;
const N = plan.n;
const g = { shaders: new Int32Array(N * N), children: new Uint8Array(N * N), colors: new Uint8Array(N * N * 3) };
for (let k = 0; k < N * N; k++) {
  g.shaders[k] = k % 17 === 0 ? 300 : 1 + (k % 5);
  g.children[k] = (k * 7) & 255;
  g.colors[k * 3] = k & 255;
  g.colors[k * 3 + 1] = (k * 3) & 255;
  g.colors[k * 3 + 2] = 77;
}
const ov = overridesOf(H.colour, plan, g);
const at = (x: number, z: number) => ((z - plan.startZ) / 2) * N + (x - plan.startX) / 2;
let oBad = 0;
for (let b = 0; b < ov.poles.m; b++) for (let a = 0; a < ov.poles.n; a++) {
  const k = at(ov.poles.x0 + a * 4, ov.poles.z0 + b * 4);
  const f = g.shaders[k];
  if (ov.poles.fam[b * ov.poles.n + a] !== (f > 255 ? 0 : f) || ov.poles.choice[b * ov.poles.n + a] !== g.children[k]) oBad++;
}
let mean = 0;
for (let bz = -2; bz <= 2; bz++) for (let ax = -2; ax <= 2; ax++) mean += (bz === -2 || bz === 2 ? 1 : 2) * (ax === -2 || ax === 2 ? 1 : 2) * g.colors[at(-640 + plan.i0 * 8 + ax * 2, -640 + plan.j0 * 8 + bz * 2) * 3];
ok(oBad === 0 && ov.cells.rgb[0] === Math.round(mean / 64), "overridesOf takes each 4 m pole's family (past a byte nought) and choice, and each cell's mean by the converter's weights");

// ---- a baked world on disk
const worlds = bakedWorlds();
if (!worlds.length) note('no baked world on disk: the converted half is skipped');
else {
  const w = (await loadBaked(worlds[0]))!;
  const L = w.header.fine;
  const s = w.swg;
  // Samples near the map's middle (the lattice's own middle), raw positions the sampler's poles.
  const mi = Math.floor(L.nx / 2);
  const mj = Math.floor(L.nz / 2);
  const store = new HeightEdits();
  const tx0 = Math.floor((L.x0 + mi * L.step) / 64);
  const tz0 = Math.floor((L.z0 + mj * L.step) / 64);
  const d = new Float32Array(1024);
  for (let k = 0; k < 1024; k++) d[k] = Math.fround(2 + (k % 32) * 0.1);
  store.set(tx0, tz0, d);
  store.set(tx0 + 1, tz0, d);
  const zeros = new HeightEdits();
  zeros.set(tx0, tz0, new Float32Array(1024));
  const half = L.q / 2 + 1e-4;
  for (const [name, st] of [['none', null], ['empty', new HeightEdits()], ['every value nought', zeros], ['a raise', store]] as const) {
    s.useHeights(st);
    const f = w.fine.slice();
    new HeightOverlay(L).layAll(f, st, null);
    let worst = 0;
    let shared = 0;
    for (let j = mj - 20; j < mj + 20; j++) for (let i = mi - 20; i < mi + 30; i++) {
      const x = L.x0 + i * L.step;
      const z = L.z0 + j * L.step;
      worst = Math.max(worst, Math.abs(f[j * L.nx + i] - poleHeight(s, x, z)));
      shared++;
    }
    ok(worst <= half, `${w.name}, the store ${name}: the field's laid heights are the game's own laid blocks' at all ${shared} shared poles within half the section's step (worst ${worst.toFixed(4)} m, step ${L.q.toFixed(4)})`);
  }
  s.useHeights(null);
  // The live generator's grid made into overrides: the bake's own corners, choices and colour cells where nothing is painted.
  const C = w.header.colour;
  // (Wave h6a: about the colour lattice's own middle, which a 4 m bake's heights lattice is not: its colour stays 8 m.)
  const ci = Math.floor(C.nx / 2);
  const cj = Math.floor(C.nz / 2);
  const p = regenPlan(C, { x0: C.x0 + (ci - 30) * C.step, z0: C.z0 + (cj - 30) * C.step, x1: C.x0 + (ci + 10) * C.step, z1: C.z0 + (cj + 10) * C.step })!;
  const grid = await s.generatePoles(p.startX, p.startZ, p.n, 2);
  const o = overridesOf(C, p, grid!);
  let fBad = 0;
  let cBad2 = 0;
  for (let b = 0; b < o.poles.m; b++) for (let a = 0; a < o.poles.n; a++) {
    const x = o.poles.x0 + a * 4;
    const z = o.poles.z0 + b * 4;
    if (o.poles.fam[b * o.poles.n + a] !== poleFamily(w.families, w.header.ground, x, z) || o.poles.choice[b * o.poles.n + a] !== (childChoiceAt(x, z) & 255)) fBad++;
  }
  let cellN = 0;
  for (let j = 0; j < o.cells.h; j++) for (let i = 0; i < o.cells.w; i++) for (let c = 0; c < 3; c++) {
    cellN++;
    if (Math.abs(o.cells.rgb[(j * o.cells.w + i) * 3 + c] - w.colour[((o.cells.j0 + j) * C.nx + o.cells.i0 + i) * 3 + c]) > 0) cBad2++;
  }
  ok(fBad === 0, `${w.name}: the live generator's 4 m poles over ${o.poles.n} by ${o.poles.m} are the bake's own corners and the place's hash where nothing is painted`);
  ok(cBad2 === 0, `${w.name}: and its cells' colour means the bake's own colour section (${cellN / 3} cells)`);
  ok(samplesIn(L, { x0: L.x0, z0: L.z0, x1: L.x0 + 2 * L.step, z1: L.z0 + L.step })!.i1 === 2, 'samplesIn takes the fine samples a raw rectangle holds');

  // W2's review: a dropped building's extent (`layerExtent`, parsed against a stand-in) is the extent the near ground's own
  // `TerrainSampler.addBuildingLayer` gave the same layer, placed and turned the same, over the world's own building layers.
  // Every baked world with building layers (Naboo's one is turned a quarter, Tatooine's are not).
  let turned = 0;
  let turnMoved = 0;
  for (const name of worlds) {
    const bw = name === w.name ? w : (JSON.parse(readFileSync(join(packs, name, 'layout.json'), 'utf8')).objects ?? []).some((o: { layer?: string; contained?: unknown }) => o.layer && !o.contained) ? await loadBaked(name) : null;
    if (!bw) continue;
    const layout = JSON.parse(readFileSync(join(bw.dir, 'layout.json'), 'utf8'));
    const ours: ({ x0: number; z0: number; x1: number; z1: number } | null)[] = [];
    for (const ob of layout.objects ?? []) {
      if (!ob.layer || ob.contained || !existsSync(join(bw.dir, ob.layer))) continue;
      if (Math.abs(yawOf(ob.q)) > 0.1) turned++;
      ours.push(layerExtent(new Uint8Array(readFileSync(join(bw.dir, ob.layer))), bw.swg.template.generator, ob.x, ob.z, yawOf(ob.q)));
    }
    const theirs = bw.swg.sampler.buildingLayers.map((l) => (l.useExtent && l.extent.x1 >= l.extent.x0 && l.extent.y1 >= l.extent.y0 ? { x0: l.extent.x0, z0: l.extent.y0, x1: l.extent.x1, z1: l.extent.y1 } : null));
    const eBad = ours.length === theirs.length ? ours.filter((e, k) => JSON.stringify(e) !== JSON.stringify(theirs[k])).length : -1;
    if (theirs.length) ok(eBad === 0 && ours.some((e) => e), `${name}: layerExtent is addBuildingLayer's own extent at every one of its ${theirs.length} building layers`);
    // The world's own turns are a quarter or none, which a square or round footprint cannot tell from none: a layer whose
    // extent a turn of 0.6 rad moves, turned so, against a sampler of its own made from the world's terrain (so the world's
    // generator is never written).
    for (const ob of layout.objects ?? []) {
      if (!ob.layer || ob.contained || !existsSync(join(bw.dir, ob.layer))) continue;
      const bytes = new Uint8Array(readFileSync(join(bw.dir, ob.layer)));
      const e = layerExtent(bytes, bw.swg.template.generator, ob.x, ob.z, 0.6);
      if (!e || JSON.stringify(e) === JSON.stringify(layerExtent(bytes, bw.swg.template.generator, ob.x, ob.z, 0))) continue;
      const tpl = parseTerrainTemplate(new Uint8Array(readFileSync(join(bw.dir, 'terrain.trn'))));
      const layer = parseLayerFile(bytes, tpl.generator)!;
      new TerrainSampler(tpl).addBuildingLayer(layer, ob.x, ob.z, 0.6);
      turnMoved++;
      ok(JSON.stringify(e) === JSON.stringify({ x0: layer.extent.x0, z0: layer.extent.y0, x1: layer.extent.x1, z1: layer.extent.y1 }), `${name}: ${ob.layer} turned 0.6 rad, layerExtent is addBuildingLayer's own extent (which the turn moves)`);
      break;
    }
  }
  if (!turnMoved) note(`no baked world has a building layer whose extent a turn moves (every one round; ${turned} turned): the turn of layerExtent is not checked`);

  // W2's review: a carved world's laid samples are the game's own laid blocks' away from the road (the course carved over the
  // blocks as they enter the cache, at no widening), and within the road's half width and the far rule's 4 m apart.
  const ri0 = mi + 180;
  const rj = mj + 30;
  const X0 = L.x0 + ri0 * L.step;
  const X1 = X0 + 200;
  const Z0 = L.z0 + rj * L.step + 3;
  const roadW = 6;
  const cc = new CourseCarve();
  cc.set([straight('h2rev', X0, X1, Z0, w.fine[rj * L.nx + ri0] + 2, { w: roadW, sh: 16 })]);
  s.sampler.course = cc;
  const fc = w.fine.slice();
  new HeightOverlay(L).layAll(fc, null, cc);
  let cWorst = 0;
  let cAway = 0;
  let cShoulder = 0;
  for (let j = rj - 10; j <= rj + 10; j++) for (let i = ri0 - 10; i <= ri0 + 35; i++) {
    const x = L.x0 + i * L.step;
    const z = L.z0 + j * L.step;
    const cx = Math.min(Math.max(x, X0), X1);
    const dist = Math.hypot(x - cx, z - Z0);
    if (dist <= roadW / 2 + 4 + 0.5) continue;
    cAway++;
    if (fc[j * L.nx + i] !== w.fine[j * L.nx + i]) cShoulder++;
    cWorst = Math.max(cWorst, Math.abs(fc[j * L.nx + i] - poleHeight(s, x, z)));
  }
  s.sampler.course = null;
  ok(cWorst <= half + 1e-3 && cShoulder > 0, `${w.name}: carved, the field's laid samples are the game's own carved blocks' at all ${cAway} samples past the road's half width and 4 m (worst ${cWorst.toFixed(4)} m; ${cShoulder} of them in the shoulder the carve moved)`);
}

// ---- W2's review: Life Day's layers in season (`seasonalExtents`), on a world whose terrain has an active seasonal layer:
// exactly the top-level layers the generator's own rule runs in season and not out of it, at their prepared extents.
const lifeDayWorld = ['corellia', ...bakedWorlds()].find((n) => existsSync(join(packs, n, 'terrain.trn')));
if (!lifeDayWorld) note('no terrain on disk: Life Day is not checked');
else {
  const was = TERRAIN_GROUND_TUNE.lifeDay;
  TERRAIN_GROUND_TUNE.lifeDay = true;
  const gen = parseTerrainTemplate(new Uint8Array(readFileSync(join(packs, lifeDayWorld, 'terrain.trn')))).generator;
  const got = seasonalExtents(gen);
  TERRAIN_GROUND_TUNE.lifeDay = false;
  const want = gen.layers.filter((l) => l.active && !gen.runs(l) && l.useExtent).map((l) => ({ x0: l.extent.x0, z0: l.extent.y0, x1: l.extent.x1, z1: l.extent.y1 }));
  TERRAIN_GROUND_TUNE.lifeDay = was;
  ok(JSON.stringify(got) === JSON.stringify(want), `${lifeDayWorld}: seasonalExtents is the generator's own rule (the layers that run in season and not out of it) at their extents (${got.length}: ${got.map((e) => `${Math.round(e.x1 - e.x0)} by ${Math.round(e.z1 - e.z0)} m`).join(', ') || 'none'})`);
  if (lifeDayWorld === 'corellia') ok(got.length > 0, 'corellia: its LIFEDAY layer is found in season');
}

console.log(`\nhorizonOverlay: ${checks} checks passed`);
