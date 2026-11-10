// The far ground's rings for a world with no converted terrain (the horizon pass's h6b, DESIGN.md §2.12 and §8): the bake made in
// the browser held to the ground the game's own `Terrain` answers (the raster's bilinear and lift less the detail, the noise
// past it, a flat ground, a test terrain), the fine lattice's cap, the families and colours it carries, the plain world's
// palette, what the edits and the carve lay over it, the paint's grid, the shape window's blocks, the field's own load over the
// worker's own steps, and day one: the decode of a real bake is d1d543f's to the byte. The hand-overs only the game makes are
// pinned as text.
//
// Run: node tools/swg/tests/horizonDem.test.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import ts from 'typescript';
import * as THREE from 'three';
import { CHUNK_SIZE, Terrain } from '../../../src/world/terrain.ts';
import { hash2 } from '../../../src/world/noise.ts';
import { makeDemPatch, madeDemPatch, type DemMeta } from '../../../src/world/demTerrain.ts';
import { DemShader, type GroundRules } from '../../../src/world/demShader.ts';
import { Wash, type WashSpec } from '../../../src/world/demWash.ts';
import { HeightEdits, HEIGHT_TILE_DELTAS } from '../../../src/swg/terrain/heightEdits.ts';
import { CARVE_BUCKET, CourseCarve, CourseGrid } from '../../../src/swg/terrain/courseCarve.ts';
import { childChoiceAt } from '../../../src/swg/terrain/generator.ts';
import { paintTileOf } from '../../../src/swg/terrain/groundPaint.ts';
import { MADE_BLOCK_POLES, MADE_POLES_SLICE_MS, MadeGround, PLAIN_GRAIN_MEAN, PlainColours, layMadeBlock, madePoles, madeRegenAsksOf, madeShapeTerrain, makeBake, paintKeysOver, paintKeysOverGame, plainAlbedoRect, plainAlbedos, type MadeGroundSpec, type MadeNoise } from '../../../src/world/horizon/horizonDem.ts';
import { ALBEDO_SCALE, composeBake, decodeBake, encByte, type DecodedBake, type TileTables } from '../../../src/world/horizon/horizonDecode.ts';
import { BAKE_DEFAULTS, HORIZON_FORMAT, HORIZON_SECTIONS, planBake, type HorizonHeader } from '../../../src/world/horizon/horizonFile.ts';
import { HeightOverlay, overridesOf, regenPlan, REGEN_STEP } from '../../../src/world/horizon/horizonOverlay.ts';
import { HorizonField, RingSession, tileTablesOf, type FieldGround } from '../../../src/world/horizon/horizonField.ts';
import { HORIZON_TUNE, RingHole, ringCardSurface } from '../../../src/world/horizon/horizonMath.ts';
import { RingCardDebt } from '../../../src/world/horizon/ringCardDebt.ts';
import { GROUND_REWRITE_TUNE, rectMeetsChunk } from '../../../src/world/groundRewrite.ts';
import { SHAPE_BLOCK, shapeSourceOf } from '../../../src/world/horizon/shapeWindow.ts';
import { NO_SHIFT, groundChunkOrigin } from '../../../src/world/groundTiles.ts';
import { straight } from './carveFixtures.ts';
import { loadOldMany } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);

const byteFamily8 = (f: number): number => (f > 255 || f < 0 ? 0 : f);
const FROM = 'd1d543f';
const REPO = resolve(import.meta.dirname, '../../..');
const text = (p: string) => readFileSync(resolve(REPO, p), 'utf8').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------- fixtures: every number the test's own, never the owner's
const NOISE: MadeNoise = { base: 3, amplitude: 40, frequency: 0.0025, octaves: 4, ridged: 0.3, flatten: 1.2, detail: 0 };
const planetOf = (terrain: MadeNoise, water: number | null, seed = 4242) =>
  ({
    id: 'testworld',
    seed,
    terrain,
    palette: { low: 0x9a9a8a, mid: 0xaaa898, high: 0xcac6b8, slope: 0x7a7468, shore: 0xb8b09a },
    ...(water === null ? {} : { water: { level: water, color: 0, opacity: 1 } }),
    pack: false,
  }) as unknown as ConstructorParameters<typeof Terrain>[0];

/** A raster of `n` samples a side, a stable pattern of bumps, in `base16.raw`'s own shape. */
function rasterOf(n: number, size: number): { raw: ArrayBuffer; meta: DemMeta } {
  const h = new Uint16Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = 20000 + Math.round(15000 * Math.sin(i * 0.17) * Math.cos(j * 0.11) + 4000 * Math.sin((i + j) * 0.53));
  return { raw: h.buffer, meta: { mapWidthInMeters: size, base: { samples: n, metresPerSample: size / (n - 1), minHeight: -120, maxHeight: 980 } } };
}

const SIZE = 1024;
const RASTER = rasterOf(129, SIZE);
const LIFT = -300;
const where = { size: SIZE, lift: LIFT, feather: 64 };
const specOf = (o: Partial<MadeGroundSpec>): MadeGroundSpec => ({
  world: 'testworld',
  size: SIZE,
  made: 'raster',
  height: 0,
  source: { raw: RASTER.raw, meta: RASTER.meta, where },
  detail: 0,
  lift: LIFT,
  terrain: NOISE,
  seed: 4242,
  families: null,
  wash: null,
  plain: { low: 0x9a9a8a, mid: 0xaaa898, high: 0xcac6b8, slope: 0x7a7468, shore: 0xb8b09a, minH: -420, maxH: 680, waterLevel: 5, water: true },
  ...o,
});
const terrainOf = (detail: number, tn: MadeNoise = NOISE): Terrain => {
  const t = new Terrain(planetOf(tn, 5));
  t.dem = makeDemPatch(RASTER.raw, RASTER.meta, where);
  t.demDetail = detail;
  return t;
};
const anySamples = (L: { x0: number; z0: number; step: number; nx: number; nz: number }, f: (rx: number, rz: number, k: number) => boolean): boolean => {
  for (let j = 0; j < L.nz; j++) for (let i = 0; i < L.nx; i++) if (!f(L.x0 + i * L.step, L.z0 + j * L.step, j * L.nx + i)) return false;
  return true;
};
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

// ---------------------------------------------------------------- the lattice's cap, the bake's own rule
{
  const at = (size: number) => planBake(size, { x: 0, z: 0 });
  const m = at(16288);
  ok(m.fine.step === 8 && m.fine.nx === 2293, `a raster of 16.3 km is made at 8 m, ${m.fine.nx} samples a side with its margin`);
  const h = at(24576);
  ok(h.fine.step === 16 && h.fine.nx === 1665, `a raster of 24.6 km at 16 m, ${h.fine.nx} a side`);
  const w = at(32768);
  ok(w.fine.step === 16 && w.fine.nx === 2177, `a new world of 32.8 km, the largest a worlds file takes, at 16 m, ${w.fine.nx} a side (it passes ${BAKE_DEFAULTS.fineMost} at 8 m)`);
  ok(w.fine.nx <= BAKE_DEFAULTS.fineMost, 'and its fine lattice stands under the cap a bake keeps to');
}

// ---------------------------------------------------------------- the heights: the raster and the noise
const G = new MadeGround(specOf({}));
const B = makeBake(G);
{
  const F = B.header.fine;
  // The raster's own arithmetic, written against its own module: the bilinear and the lift, the feather blended onto the noise, no detail.
  const t = terrainOf(0);
  ok(anySamples(F, (rx, rz, k) => Object.is(B.fine[k], Math.fround(t.groundRawAt(-rx, rz)))), `every fine sample (${F.nx * F.nz}) is Terrain's own ground (the raster's bilinear, its lift, the feather onto the noise) to the bit`);
  const C = B.header.coarse;
  ok(anySamples(C, (rx, rz, k) => Object.is(B.coarse[k], Math.fround(t.groundRawAt(-rx, rz)))), `every coarse sample (${C.nx * C.nz}), the noise past the raster, likewise`);
  const inside = anySamples(F, (rx, rz, k) => Math.abs(rx) > SIZE / 2 - 80 || Math.abs(rz) > SIZE / 2 - 80 || Object.is(B.fine[k], Math.fround(makeDemPatch(RASTER.raw, RASTER.meta, where).heightAt(-rx, rz, () => Number.NaN)!)));
  ok(inside, "inside the feather's reach, the patch's own bilinear with nothing of the noise");
  let lo = Infinity;
  let hi = -Infinity;
  for (const h of B.fine) {
    if (h < lo) lo = h;
    if (h > hi) hi = h;
  }
  ok(F.lo === lo && Math.abs(F.q - (hi - lo) / 65535) < 1e-12, "the header carries its heights' span, as a bake's does");
  ok(B.header.source.made === 'browser' && B.header.format === HORIZON_FORMAT, "the header says the browser made it, in the bake's own format");
  ok(HORIZON_SECTIONS.every((n) => B.header.sections.some((s) => s.name === n && s.size > 0)), "and lists the bake's own six sections at their own sizes");
  const P = planBake(SIZE, { x: 0, z: 0 });
  ok(F.step === P.fine.step && F.x0 === P.fine.x0 && F.nx === P.fine.nx && B.header.coarse.nx === P.coarse.nx && B.header.ground.nx === P.ground.nx, "and stands on the bake's own plan about (0, 0)");
  const c = B.header.colour;
  ok(c.x0 === F.x0 && c.z0 === F.z0 && c.step === F.step && c.nx === F.nx && c.nz === F.nz, 'on a world about (0, 0) the colour lattice is the fine one, sample for sample');
}
{
  // The fractal detail: in the near ground's, out of the rings'.
  const withDetail: MadeNoise = { ...NOISE, detail: 0.7 };
  const t = terrainOf(1.3, withDetail);
  const g = new MadeGround(specOf({ detail: 1.3, terrain: withDetail }));
  const flat = terrainOf(0, NOISE);
  let near = true;
  let far = true;
  for (let n = 0; n < 40000; n++) {
    const x = (rnd() - 0.5) * 6000;
    const z = (rnd() - 0.5) * 6000;
    if (!Object.is(g.nearAt(x, z), t.groundRawAt(x, z))) near = false;
    if (!Object.is(g.farAt(x, z), flat.groundRawAt(x, z))) far = false;
  }
  ok(near, "nearAt is Terrain.groundRawAt to the bit, the raster's detail and the noise's included (40,000 places, in the raster, its feather and past it)");
  ok(far, "farAt is the same ground with no detail of either kind (the near ground keeps it, the drop covers it at the seam)");
  const grid = g.polesIn(-64, -128, 16, 2);
  let same = true;
  for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) if (!Object.is(grid[j * 16 + i], Math.fround(t.groundRawAt(-(-64 + i * 2), -128 + j * 2)))) same = false;
  ok(same, "the worker's 2 m poles are the near ground's, in the raw frame (x mirrored)");
}
{
  // A world of yours: flat, and a test terrain.
  const flatN: MadeNoise = { base: 12, amplitude: 0, frequency: 0.004, octaves: 1, ridged: 0, flatten: 1, detail: 0 };
  const g = new MadeGround(specOf({ made: 'flat', height: 12, source: null, terrain: flatN, detail: 0 }));
  const b = makeBake(g);
  ok(b.fine.every((h) => h === 12) && b.coarse.every((h) => h === 12), 'a flat world stands every sample at its height, inside its square and past it');
  const t = new Terrain(planetOf(NOISE, null));
  t.dem = madeDemPatch('noise', SIZE, 0, NOISE);
  const n = makeBake(new MadeGround(specOf({ made: 'noise', source: null })));
  ok(anySamples(n.header.fine, (rx, rz, k) => Object.is(n.fine[k], Math.fround(t.groundRawAt(-rx, rz)))), "a test terrain's rings are its Terrain's own noise to the bit");
  const none = new Terrain(planetOf(NOISE, null));
  ok(anySamples(n.header.coarse, (rx, rz, k) => Object.is(n.coarse[k], Math.fround(none.groundRawAt(-rx, rz)))), 'and a world whose raster is not served stands on the same noise, as its near ground does');
}

// ---------------------------------------------------------------- the families and the colours
const RULES: GroundRules = { pack: 'lok', fallback: 'sand', rules: [{ family: 'rock', aboveSlope: 18 }, { family: 'grass', belowElevation: 100, fuzz: 8 }, { family: 'dirt', aboveHollow: 0.4 }] };
const NAMES: [string, number][] = [['sand', 2], ['rock', 7], ['grass', 11], ['dirt', 300]];
{
  const g = new MadeGround(specOf({ families: { spec: RULES, names: NAMES, lift: LIFT, baseId: -1 }, plain: null, detail: 1 }));
  const b = makeBake(g);
  const t = terrainOf(1);
  const shader = new DemShader(RULES, new Map(NAMES), LIFT, 4);
  const near = (x: number, z: number) => t.groundRawAt(x, z);
  const byte = (f: number) => (f > 255 || f < 0 ? 0 : f);
  ok(anySamples(b.header.ground, (rx, rz, k) => b.families[k] === byte(shader.familyAt(-rx, rz, near))), "a ruled world's families at every 8 m corner are its rules asked of its near ground, in the game's frame");
  ok(anySamples(b.header.coarse, (rx, rz, k) => b.coarseFamilies[k] === byte(shader.familyAt(-rx, rz, near))), 'and at every coarse sample');
  ok(new Set(b.families).size >= 3, `and more than one family stands (${new Set(b.families).size})`);
  // A wide world (16 m): the rules asked at the heights' own step, each answer held over its block of 8 m corners.
  const wideRules: GroundRules = { pack: 'lok', fallback: 'sand', rules: [{ family: 'rock', belowElevation: 300 }, { family: 'grass', aboveElevation: 300 }] };
  const wideN: MadeNoise = { ...NOISE, amplitude: 300, frequency: 0.001, octaves: 1, ridged: 0, flatten: 1 };
  const wide = makeBake(new MadeGround(specOf({ size: 18432, made: 'noise', source: null, terrain: wideN, lift: 0, families: { spec: wideRules, names: NAMES, lift: 0, baseId: -1 }, plain: null })));
  const WG = wide.header.ground;
  const wt = new Terrain(planetOf(wideN, null));
  wt.dem = madeDemPatch('noise', 18432, 0, wideN);
  const wideShader = new DemShader(wideRules, new Map(NAMES), 0, 4);
  const wideNear = (x: number, z: number) => wt.groundRawAt(x, z);
  let held = 0;
  let wrong = 0;
  for (let j = 0; j < WG.nz; j += 37) {
    for (let i = 0; i < WG.nx; i += 41) {
      const a = i - (i % 2);
      const c = j - (j % 2);
      if (wide.families[j * WG.nx + i] !== byteFamily8(wideShader.familyAt(-(WG.x0 + a * 8), WG.z0 + c * 8, wideNear))) wrong++;
      held++;
    }
  }
  ok(wide.header.fine.step === 16 && WG.step === 8 && wrong === 0 && new Set(wide.families).size === 2, `a wide world's families are the rules asked at 16 m and held over their 8 m corners (${held} places, ${wrong} wrong)`);
  let blocksWhole = true;
  for (let j = 0; j < WG.nz && blocksWhole; j++) for (let i = 0; i < WG.nx; i++) if (wide.families[j * WG.nx + i] !== wide.families[(j - (j % 2)) * WG.nx + i - (i % 2)]) { blocksWhole = false; break; }
  ok(blocksWhole, 'and every block of four corners holds one answer');
  const past = makeBake(new MadeGround(specOf({ families: { spec: { pack: 'lok', fallback: 'dirt', rules: [{ family: 'dirt' }] }, names: NAMES, lift: LIFT, baseId: -1 }, plain: null })));
  ok(past.families.every((f) => f === 0), 'a family past a byte is nought, as a bake keeps it');
  const base = makeBake(new MadeGround(specOf({ families: { spec: { pack: 'lok', fallback: 'sand', rules: [] }, names: NAMES, lift: LIFT, baseId: 7 }, plain: null })));
  ok(base.families.every((f) => f === 7) && base.coarseFamilies.every((f) => f === 7), "a world that names only a base stands it everywhere (the paint's own base id over the rules' fallback)");
  const fall = makeBake(new MadeGround(specOf({ families: { spec: { pack: 'lok', fallback: 'sand', rules: [] }, names: NAMES, lift: LIFT, baseId: -1 }, plain: null })));
  ok(fall.families.every((f) => f === 2), "with no base, the rules' own fallback");
  ok(B.families.every((f) => f === 0) && B.coarseFamilies.every((f) => f === 0), 'a plain world names family nought everywhere');
  ok(B.colour.every((c) => c === 255) && B.coarseColour.every((c) => c === 255), "and with no wash every colour cell is white, as the near ground's samples are");
}
{
  const spec: WashSpec = { base: [180, 120, 90], bands: [{ above: 200, colour: [40, 90, 200], amount: 0.5 }, { slopeAbove: 12, colour: [200, 200, 30], amount: 0.8 }], noise: { scale: 700, amount: 0.1, seed: 5 } };
  const b = makeBake(new MadeGround(specOf({ wash: spec, families: { spec: { pack: 'lok', fallback: 'sand', rules: [] }, names: NAMES, lift: LIFT, baseId: 2 }, plain: null })));
  const w = new Wash(spec);
  const F = b.header.fine;
  const px = new Uint8Array(3);
  let same = true;
  let bands = new Set<number>();
  for (let j = 1; j < F.nz - 1; j += 7) {
    for (let i = 1; i < F.nx - 1; i += 7) {
      const k = j * F.nx + i;
      const dx = (b.fine[j * F.nx + i + 1] - b.fine[j * F.nx + i - 1]) / (2 * F.step);
      const dz = (b.fine[(j + 1) * F.nx + i] - b.fine[(j - 1) * F.nx + i]) / (2 * F.step);
      w.colourAt(F.x0 + i * F.step, F.z0 + j * F.step, b.fine[k] - LIFT, Math.atan(Math.sqrt(dx * dx + dz * dz)) * 57.29577951308232, px);
      if (b.colour[k * 3] !== px[0] || b.colour[k * 3 + 1] !== px[1] || b.colour[k * 3 + 2] !== px[2]) same = false;
      bands.add(px[0]);
    }
  }
  ok(same && bands.size > 3, `a wash colours each cell by its own place, its height over sea level and its slope (${bands.size} reds)`);
}
{
  // The plain world: the very colour its chunks' vertices take.
  const t = new Terrain(planetOf(NOISE, 5));
  t.minH = -420;
  t.maxH = 680;
  const out = new THREE.Color();
  const pc = new PlainColours({ low: 0x9a9a8a, mid: 0xaaa898, high: 0xcac6b8, slope: 0x7a7468, shore: 0xb8b09a, minH: -420, maxH: 680, waterLevel: 5, water: true });
  const rgb = new Float64Array(3);
  let worst = 0;
  for (let n = 0; n < 20000; n++) {
    const x = (rnd() - 0.5) * 4000;
    const z = (rnd() - 0.5) * 4000;
    const h = -500 + rnd() * 1300;
    const ny = 0.3 + rnd() * 0.7;
    (t as unknown as { colorAt(h: number, ny: number, x: number, z: number, o: THREE.Color): void }).colorAt(h, ny, x, z, out);
    pc.colourAt(h, ny, rgb);
    const grain = 0.9 + 0.14 * hash2(Math.floor(x * 2), Math.floor(z * 2), 4242);
    const g = PLAIN_GRAIN_MEAN / grain;
    worst = Math.max(worst, Math.abs(rgb[0] - out.r * g), Math.abs(rgb[1] - out.g * g), Math.abs(rgb[2] - out.b * g));
  }
  ok(worst < 1e-12, `a plain world's colour is Terrain.colorAt less the grain, at its mean (worst ${worst.toExponential(1)} over 20,000 places)`);
  let grains = 0;
  for (let n = 0; n < 200000; n++) grains += 0.9 + 0.14 * hash2(Math.floor((rnd() - 0.5) * 8000), Math.floor((rnd() - 0.5) * 8000), 4242);
  grains /= 200000;
  ok(Math.abs(grains - PLAIN_GRAIN_MEAN) < 0.003, `and the grain's mean is the one measured over the planet's own hash (${grains.toFixed(4)} against ${PLAIN_GRAIN_MEAN})`);
  const a = plainAlbedos(B, specOf({}).plain!);
  const F = B.header.fine;
  const i = 100;
  const j = 150;
  const dx = (B.fine[j * F.nx + i + 1] - B.fine[j * F.nx + i - 1]) / (2 * F.step);
  const dz = (B.fine[(j + 1) * F.nx + i] - B.fine[(j - 1) * F.nx + i]) / (2 * F.step);
  pc.colourAt(B.fine[j * F.nx + i], 1 / Math.sqrt(dx * dx + 1 + dz * dz), rgb);
  const o = (j * F.nx + i) * 4;
  ok(a.albedo[o] === encByte(rgb[0] / ALBEDO_SCALE) && a.albedo[o + 1] === encByte(rgb[1] / ALBEDO_SCALE) && a.albedo[o + 2] === encByte(rgb[2] / ALBEDO_SCALE) && a.albedo[o + 3] === 0, 'its albedo holds that colour in the bake\'s own encoding, by the sample\'s height and its normal');
  ok(a.albedo.length === F.nx * F.nz * 4 && a.coarseAlbedo.length === B.header.coarse.nx * B.header.coarse.nz * 4, 'one texel a colour cell and a coarse sample');
  const sub = plainAlbedoRect(pc, B.fine, F, 40, 60, 44, 63, new Uint8Array(5 * 4 * 4), 40, 60, 5);
  let rect = true;
  for (let n = 60; n <= 63; n++) for (let m = 40; m <= 44; m++) for (let c = 0; c < 4; c++) if (sub[((n - 60) * 5 + m - 40) * 4 + c] !== a.albedo[(n * F.nx + m) * 4 + c]) rect = false;
  ok(rect, "a rectangle's albedo (a stroke over a plain world) is the whole's, at its own texels");
}

// ---------------------------------------------------------------- the overlays over a made bake: the near ground's own
{
  const t = terrainOf(0);
  const edits = new HeightEdits();
  const d = new Float32Array(HEIGHT_TILE_DELTAS);
  for (let j = 0; j < 32; j++) for (let i = 0; i < 32; i++) d[j * 32 + i] = 3 + j * 0.25 - i * 0.125;
  edits.set(1, -2, d);
  t.heights = edits;
  const b = makeBake(new MadeGround(specOf({})));
  const fine = b.fine;
  const o = new HeightOverlay(b.header.fine);
  o.layAll(fine, edits, null);
  // (Within a float32 step or two: the bake adds the delta to a float32 height, the near ground to a double.)
  ok(anySamples(b.header.fine, (rx, rz, k) => Math.abs(fine[k] - t.heightAt(-rx, rz)) < 1e-4), "the owner's edits laid over a made bake are Terrain.heightAt at every sample");
  ok(o.kept >= 1, 'and the tile keeps a raw copy, so an undo puts it back to the bit');
  edits.clear();
  o.layAll(fine, edits, null);
  const fresh = makeBake(new MadeGround(specOf({}))).fine;
  ok(fine.every((h, i) => Object.is(h, fresh[i])), 'the edits taken away, the bake is its own again to the bit');
  // The carve under the edits.
  const course = new CourseCarve();
  course.set([straight('h6b', -200, 200, -40, 11, { w: 6, sh: 6 })]);
  const cover = new HeightOverlay(b.header.fine);
  const f2 = makeBake(new MadeGround(specOf({}))).fine;
  cover.layAll(f2, null, course);
  const L = b.header.fine;
  const onRoad = (L.nx >> 1) + ((-40 - L.z0) / L.step) * L.nx;
  ok(Math.abs(f2[onRoad] - 11) < 0.01, `a drawn course is carved into the bake (the road's own height at its middle, ${f2[onRoad].toFixed(3)})`);
}
{
  // The paint's grid, on the main thread: exactly what `overridesOf` reads.
  const shader = new DemShader(RULES, new Map(NAMES), LIFT, 4);
  const t = terrainOf(0);
  const near = (x: number, z: number) => t.groundRawAt(x, z);
  let breaths = 0;
  let clock = 0;
  const src = { familyAt: (gx: number, gz: number) => shader.familyAt(gx, gz, near), choiceAt: (gx: number, gz: number) => childChoiceAt(-gx, gz), colourAt: (gx: number, gz: number, out: Uint8Array) => { out[0] = 10; out[1] = 20; out[2] = 30; }, white: false };
  const C = B.header.colour;
  const plan = regenPlan(C, { x0: 0, z0: 0, x1: 512, z1: 512 })!;
  const g = await madePoles(src, plan.startX, plan.startZ, plan.n, REGEN_STEP, async () => { breaths++; }, () => (clock += MADE_POLES_SLICE_MS / 8));
  ok(breaths > 0, `the grid is worked in slices, the frame given its turn (${breaths} breaths)`);
  const ov = overridesOf(C, plan, g);
  const P = ov.poles;
  let same = true;
  for (let b = 0; b < P.m; b += 3) for (let a = 0; a < P.n; a += 3) {
    const rx = P.x0 + a * 4;
    const rz = P.z0 + b * 4;
    const f = shader.familyAt(-rx, rz, near);
    if (P.fam[b * P.n + a] !== (f > 255 || f < 0 ? 0 : f) || P.choice[b * P.n + a] !== childChoiceAt(rx, rz)) same = false;
  }
  ok(same, "every 4 m pole's family and choice is the near ground's own, the rules and the pole's own hash");
  ok(ov.cells.rgb[0] === 10 && ov.cells.rgb[1] === 20 && ov.cells.rgb[2] === 30, 'and each cell its colour map');
  const w = await madePoles({ ...src, white: true, colourAt: () => assert.fail('asked a colour of a world nothing colours') }, plan.startX, plan.startZ, 32, REGEN_STEP, async () => {});
  ok(w.colors.every((c) => c === 255), "a world nothing colours is white with no colour asked");
  ok(g.heights.length === 0, 'and a paint moves no height, so none is made');
}
{
  ok(paintKeysOver(-10, -10, 10, 10).length === 4, 'a rectangle over the origin names the four 512 m tiles round it');
  const k = paintKeysOver(1030, 2, 1040, 3)[0];
  const t = paintTileOf(k);
  ok(t.tx === 2 && t.tz === 0, 'and a tile is named as the paint names it');
}
{
  // The shape window's blocks: raw from the worker, laid by the near ground's own rule.
  const edits = new HeightEdits();
  const d = new Float32Array(32 * 32);
  d.fill(2.5);
  edits.set(0, 0, d);
  const course = new CourseCarve();
  course.set([straight('sw', -300, 300, 30, 9, { w: 5, sh: 6 })]);
  const stores = { heights: edits, course };
  const raw = new Float32Array(MADE_BLOCK_POLES * MADE_BLOCK_POLES);
  for (let k = 0; k < raw.length; k++) raw[k] = 1 + k * 1e-3;
  const laid = raw.slice();
  layMadeBlock(0, 0, laid, stores);
  const t = terrainOf(0);
  t.heights = edits;
  const grid = new CourseGrid(course);
  grid.all();
  grid.step(Infinity, 0, 0, () => performance.now());
  let same = true;
  for (let j = 0; j < MADE_BLOCK_POLES; j++) for (let i = 0; i < MADE_BLOCK_POLES; i++) {
    const rx = -4 + i * 2;
    const rz = -4 + j * 2;
    let h = grid.carveAt(raw[j * MADE_BLOCK_POLES + i], rx, rz);
    const dd = edits.bilinear(rx, rz);
    if (dd !== 0) h = Math.fround(Math.fround(h) + dd);
    if (Math.abs(laid[j * MADE_BLOCK_POLES + i] - h) > 1e-3) same = false;
  }
  ok(same, 'a block laid is the near ground\'s pole grid and its edits over the raw heights');
  const none = raw.slice();
  layMadeBlock(40, 40, none, stores);
  ok(none.every((h, i) => Object.is(h, raw[i])), 'and a block neither touches is left as it came');
  let asked = 0;
  const field = { workerUp: true, madePoles: async (_x: number, _z: number, n: number) => { asked++; return { heights: new Float32Array(n * n).fill(7) }; } };
  const src = shapeSourceOf(madeShapeTerrain(field, { heights: null, course: null }));
  const scratch = new Float32Array(SHAPE_BLOCK * SHAPE_BLOCK);
  ok(src.cached(3, 3, scratch) === false, "a made world has no cache of blocks to copy");
  const m = await src.make(3, 3);
  ok(asked === 1 && !!m && !(m instanceof Float32Array) && m.inner.every((h) => h === 7) && m.raw.length === MADE_BLOCK_POLES * MADE_BLOCK_POLES, "its window's blocks are asked of the worker, the raw grid kept beside the laid poles");
}

// ---------------------------------------------------------------- the field's own load, through the worker's own steps
type Post = { type: string; id: number; spec?: MadeGroundSpec; tables?: TileTables | null; startX?: number; startZ?: number; n?: number; step?: number; shift?: { x: number; z: number }; centre?: { x: number; z: number }; eye?: { rx: number; rz: number }; S?: number };
const posted: Post[] = [];
class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: unknown = null;
  onmessageerror: unknown = null;
  private g: MadeGround | null = null;
  terminated = false;
  postMessage(m: Post): void {
    posted.push(m);
    setTimeout(() => {
      if (this.terminated) return;
      if (m.type === 'make') {
        const g = (this.g = new MadeGround(m.spec!));
        const b = makeBake(g);
        const plain = m.tables ? null : plainAlbedos(b, m.spec!.plain!);
        const d = composeBake(b.header, b.fine, b.coarse, b, m.tables!, m.centre!, m.shift!, m.eye!, m.S!, { inflate: 0, heights: 0, normals: 0, albedo: 0, pyramid: 0, detail: 0, memo: 0 }, plain);
        d.header = b.header;
        this.onmessage?.({ data: { type: 'decoded', id: m.id, d } });
      } else if (m.type === 'poles') this.onmessage?.({ data: { type: 'poles', id: m.id, heights: this.g!.polesIn(m.startX!, m.startZ!, m.n!, m.step!) } });
    }, 1);
  }
  terminate(): void {
    this.terminated = true;
  }
}
(globalThis as unknown as { Worker: unknown }).Worker = FakeWorker;

const session = new RingSession(null);
{
  const was = session.ground.uGroundFrame.value.x;
  session.ground.uGroundFrame.value.x = 1234;
  const field = new HorizonField('testworld', { x: 0, z: 0 }, NO_SHIFT);
  const edits = new HeightEdits();
  const d = new Float32Array(32 * 32).fill(6);
  edits.set(0, 0, d);
  const stores = { heights: edits as HeightEdits | null, course: null };
  const loaded = await field.loadMade(specOf({}), null, session, null, { x: 0, z: 0 }, stores);
  ok(loaded && field.state.state === 'ready', "a plain world's field loads with no tile arrays");
  ok(field.header?.source.made === 'browser', 'and carries the header its worker made');
  ok(session.ground.uGroundFrame.value.x === 0, "the rings' frame is this world's (0, 0), never the last world's centre");
  session.ground.uGroundFrame.value.x = was;
  const raw = terrainOf(0);
  raw.heights = edits;
  const onEdit = field.heightRaw(40, 40);
  ok(Math.abs(onEdit - raw.heightAt(-40, 40)) < 1e-3, `the arrival's edits are laid (${onEdit.toFixed(2)}) and heightRaw reads them`);
  ok(field.relay(0, 0, 8, 8, stores) > 0, 'a stroke relays over a made field');
  const sent = posted.length;
  (field as unknown as { windowStale: boolean; askWindow(): void }).windowStale = true;
  (field as unknown as { askWindow(): void }).askWindow();
  ok(posted.length === sent, 'a plain world asks no composition window of its worker, even one marked stale');
  ok(field.workerUp, 'its worker stands for the shape window');
  const poles = await field.madePoles(0, 0, 4, 2);
  ok(!!poles && poles.heights.length === 16, 'and answers its poles by the field');
  const hanging = field.madePoles(0, 0, 4, 2);
  field.dispose(null);
  ok((await hanging) === null, 'a field let go answers every wait with nothing');
}
{
  // With families: composed from the tile tables exactly as a bake's.
  const layers = 3;
  const size = 4;
  const ground: FieldGround = {
    tiler: { rank: (f: number) => f, layer: (f: number) => f % layers, corners: [0, 1, 2, 3], census: new Float64Array(5) } as unknown as FieldGround['tiler'],
    colour: new Uint8Array(size * size * 4 * layers).fill(128),
    size,
    depth: layers,
    masks: new Uint8Array(4 * 4 * 3).fill(128),
    ms: 4,
    reference: null,
  };
  const spec = specOf({ families: { spec: { pack: 'lok', fallback: 'sand', rules: [] }, names: NAMES, lift: LIFT, baseId: 2 }, plain: null });
  const field = new HorizonField('testworld', { x: 0, z: 0 }, NO_SHIFT);
  ok((await field.loadMade(spec, ground, session, null, { x: 0, z: 0 })) && field.plain === null, "a world with a lent ground's tile arrays composes its albedo as a bake does");
  const sent = posted.length;
  (field as unknown as { windowStale: boolean; askWindow(): void }).windowStale = true;
  (field as unknown as { askWindow(): void }).askWindow();
  ok(posted.length === sent + 1, 'and its composition window is asked of the worker as a bake\'s is');
  field.dispose(null);
}
{
  // A plain world's colours follow its heights (h6b's review round): its palette's by height and slope over the edited
  // heights, at the arrival (before the textures exist) and on a stroke (each tile's rectangle put on the card).
  type Open = { albedo: THREE.DataTexture; fineH: Float32Array; header: HorizonHeader };
  const pc = new PlainColours(specOf({}).plain!);
  const edits = new HeightEdits();
  const d = new Float32Array(HEIGHT_TILE_DELTAS);
  for (let j = 0; j < 32; j++) for (let i = 0; i < 32; i++) d[j * 32 + i] = 40 + j * 1.5 - i * 0.75;
  edits.set(1, -2, d);
  const field = new HorizonField('testworld', { x: 0, z: 0 }, NO_SHIFT);
  ok(await field.loadMade(specOf({}), null, session, null, { x: 0, z: 0 }, { heights: edits, course: null }), "a plain world's field loads with an edit kept");
  const p = field as unknown as Open;
  const L = p.header.fine;
  const want = plainAlbedoRect(pc, p.fineH, L, 0, 0, L.nx - 1, L.nz - 1, new Uint8Array(L.nx * L.nz * 4));
  const got = p.albedo.image.data as unknown as Uint8Array;
  ok(got.length === want.length && got.every((v, k) => v === want[k]), "its arrival's albedo is its palette's over the edited heights, at every texel");
  const before = plainAlbedos(makeBake(new MadeGround(specOf({}))), specOf({}).plain!).albedo;
  let moved = 0;
  for (let k = 0; k < got.length; k++) if (got[k] !== before[k]) moved++;
  ok(moved > 0, `and the edit moved its colours from the unedited bake's (${moved} bytes)`);
  field.dispose(null);
  // On a stroke, with the textures on the card: the tile's rectangle uploaded, its palette's colour over the heights laid.
  const uploads: { dst: unknown; data: Uint8Array; x: number; y: number; w: number; h: number }[] = [];
  const renderer = {
    initTexture() {},
    copyTextureToTexture(src: THREE.DataTexture, dst: unknown, _r: unknown, at: THREE.Vector2) {
      uploads.push({ dst, data: src.image.data as unknown as Uint8Array, x: at.x, y: at.y, w: src.image.width, h: src.image.height });
    },
  } as unknown as THREE.WebGLRenderer;
  const live = new HorizonField('testworld', { x: 0, z: 0 }, NO_SHIFT);
  const stores = { heights: null as HeightEdits | null, course: null };
  ok(await live.loadMade(specOf({}), null, session, renderer, { x: 0, z: 0 }, stores), 'and loads with a renderer and no edit');
  const q = live as unknown as Open;
  const LL = q.header.fine;
  const unedited = plainAlbedoRect(pc, q.fineH, LL, 0, 0, LL.nx - 1, LL.nz - 1, new Uint8Array(LL.nx * LL.nz * 4));
  stores.heights = edits;
  ok(live.relay(64, -128, 128, -64, stores) > 0, 'a stroke over it relays');
  const ups = uploads.filter((u) => u.dst === q.albedo);
  let same = ups.length > 0;
  let differs = 0;
  for (const u of ups) {
    const exp = plainAlbedoRect(pc, q.fineH, LL, u.x, u.y, u.x + u.w - 1, u.y + u.h - 1, new Uint8Array(u.w * u.h * 4), u.x, u.y, u.w);
    for (let k = 0; k < exp.length; k++) if (u.data[k] !== exp[k]) same = false;
    for (let j = 0; j < u.h; j++) for (let i = 0; i < u.w * 4; i++) if (u.data[j * u.w * 4 + i] !== unedited[((u.y + j) * LL.nx + u.x) * 4 + i]) differs++;
  }
  ok(same && differs > 0, `and puts on the card the palette's colours over the heights it laid (${ups.length} rectangle${ups.length === 1 ? '' : 's'}, ${differs} bytes moved)`);
  live.dispose(null);
}
{
  // A ruled made world's arrival composes again the tiles its kept edits and its drawn courses moved (h6b's review round): the
  // near ground asks its rules of the carved and edited heights, while the worker made the bake's of the raw ground.
  const course = new CourseCarve();
  course.set([straight('h6br', -200, 200, -40, 11, { w: 6, sh: 6 })]);
  const grid = new CourseGrid(course);
  grid.all();
  grid.step(Infinity, 0, 0, () => performance.now());
  const t = terrainOf(0);
  t.courseGrid = grid;
  const shader = new DemShader(RULES, new Map(NAMES), LIFT, 4);
  const asks = madeRegenAsksOf(null, null, course, true);
  const inAsk = (rx: number, rz: number) => asks.some((a) => rx >= a.x0 && rx <= a.x1 && rz >= a.z0 && rz <= a.z1);
  let changed = 0;
  let uncovered = 0;
  const carved = (x: number, z: number) => t.heightAt(x, z);
  const raw = (x: number, z: number) => t.groundRawAt(x, z);
  for (let rz = -120; rz <= 40; rz += 2) for (let rx = -260; rx <= 260; rx += 2) {
    if (shader.familyAt(-rx, rz, carved) === shader.familyAt(-rx, rz, raw)) continue;
    changed++;
    if (!inAsk(rx, rz)) uncovered++;
  }
  ok(changed > 0 && uncovered === 0, `every 2 m pole whose family the carve moves (${changed}) lies in a tile the arrival composes again (${asks.length} tiles)`);
  ok(course.cells().every(([cx, cz]) => inAsk((cx + 0.5) * CARVE_BUCKET, (cz + 0.5) * CARVE_BUCKET)) && asks.every((a) => !a.heights && a.x1 - a.x0 === 512), "and every cell the course carves, each a 512 m paint tile that moves no height");
  ok(madeRegenAsksOf(null, null, course, false).length === 0, 'a world whose families follow no height (a plain one) asks nothing of its course');
  const edits = new HeightEdits();
  edits.set(1, -2, new Float32Array(HEIGHT_TILE_DELTAS).fill(4));
  edits.set(20, 3, new Float32Array(HEIGHT_TILE_DELTAS).fill(4));
  const ea = madeRegenAsksOf(null, edits, null, true);
  ok(ea.length === 2 && ea.some((a) => a.x0 === 0 && a.z0 === -512) && ea.some((a) => a.x0 === 1024 && a.z0 === 0), "a ruled world's edits ask their own 512 m tiles");
  ok(madeRegenAsksOf(null, edits, null, false).length === 0, 'a plain world\'s none');
  const paint = { empty: false, fam: new Map([[paintKeysOver(10, 10, 11, 11)[0], 1]]), col: new Map([[paintKeysOver(10, 10, 11, 11)[0], 1]]) };
  ok(madeRegenAsksOf(paint, null, null, false).length === 1, 'the paint is asked once a tile, whatever follows the heights');
  ok([...paintKeysOverGame([{ x0: 10, z0: -50, x1: 700, z1: -30 }], 1)].join() === paintKeysOver(-700, -50, -10, -30).join(), "a game-frame rectangle names the raw frame's tiles, x mirrored");
}

// ---------------------------------------------------------------- day one: a real bake's decode is d1d543f's to the byte
{
  const plan = planBake(512, { x: 0, z: 0 }, { margin: 64, farMargin: 256 });
  const hn = plan.fine.nx * plan.fine.nz;
  const cn = plan.coarse.nx * plan.coarse.nz;
  const steps = (n: number, nx: number, f: (k: number) => number) => {
    const bytes = new Uint8Array(n * 2);
    let last = 0;
    for (let k = 0; k < n; k++) {
      if (k % nx === 0) last = 0;
      const s = f(k) & 0xffff;
      const d = (s - last) & 0xffff;
      last = s;
      bytes[k] = d & 255;
      bytes[n + k] = d >> 8;
    }
    return bytes;
  };
  const raw: Record<string, Uint8Array> = {
    heights: steps(hn, plan.fine.nx, (k) => 30000 + Math.round(9000 * Math.sin(k * 0.07))),
    families: new Uint8Array(plan.ground.nx * plan.ground.nz).map((_, k) => (k * 7) % 5),
    colour: new Uint8Array(plan.colour.nx * plan.colour.nz * 3).map((_, k) => (k * 13) % 256),
    coarseHeights: steps(cn, plan.coarse.nx, (k) => 28000 + (k % 900)),
    coarseFamilies: new Uint8Array(cn).map((_, k) => k % 3),
    coarseColour: new Uint8Array(cn * 3).map((_, k) => (k * 3) % 256),
  };
  const parts: Uint8Array[] = [];
  let offset = 0;
  const sections = HORIZON_SECTIONS.map((name) => {
    const d = new Uint8Array(deflateSync(raw[name]));
    parts.push(d);
    const s = { name, offset, length: d.length, size: raw[name].length };
    offset += d.length;
    return s;
  });
  const bin = new Uint8Array(offset);
  let at = 0;
  for (const p of parts) {
    bin.set(p, at);
    at += p.length;
  }
  const header: HorizonHeader = { format: HORIZON_FORMAT, source: { generator: 1, trn: { length: 1, sha1: 'x' }, inputs: 'y', centre: { x: 0, z: 0 }, layers: { sha1: 'z', list: [] }, lifeDay: false, made: 'poles' }, fine: { ...plan.fine, lo: -40, q: 0.01 }, ground: plan.ground, colour: plan.colour, coarse: { ...plan.coarse, lo: -60, q: 0.02 }, sections };
  const L = 5;
  const tables = (): TileTables => ({ layerOf: new Uint8Array(65536).map((_, k) => (k >> 8) % L), rankOf: new Float64Array(256).map((_, k) => k % 7), corners: [0, 1, 2, 3], means: new Float32Array(L * 3).map((_, k) => 0.1 + k * 0.05), masks: new Uint8Array(4 * 4 * 3).map((_, k) => (k * 37) % 256), ms: 4, tintMode: 1, gainCap: 2, reference: null, add: false, painted: true });
  const digest = (d: DecodedBake) => {
    const h = createHash('sha1');
    for (const a of [d.fine, d.coarse, d.fineNormal, d.albedo, d.coarseAlbedo, d.window, d.tint]) h.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
    h.update(JSON.stringify(d.place));
    for (const a of [...d.pyramid.lo, ...d.pyramid.hi]) h.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
    return h.digest('hex').slice(0, 16);
  };
  const today = await decodeBake(header, bin, tables(), { x: 0, z: 0 }, { x: 0, z: 0 }, { rx: 16, rz: -40 }, 128);
  const RECORDED = 'd4d619d12e950321';
  const mod = await loadOldMany(['src/world/horizon/horizonDecode.ts'], ['src/world/horizon/horizonDecode.ts'], FROM).catch(() => null);
  const old = mod?.[0] as { decodeBake: typeof decodeBake } | undefined;
  if (old) {
    const was = await old.decodeBake(header, bin, tables(), { x: 0, z: 0 }, { x: 0, z: 0 }, { rx: 16, rz: -40 }, 128);
    ok(digest(today) === digest(was), `a bake's decode is ${FROM}'s to the byte, its every array and its window's place (${digest(today)})`);
    ok(digest(was) === RECORDED, `and ${FROM}'s hashes as recorded (${digest(was)})`);
  } else {
    note(`git cannot hand ${FROM} over: the decode held to its recorded hash alone`);
    ok(digest(today) === RECORDED, `a bake's decode hashes as ${FROM}'s did (${digest(today)})`);
  }
  // A field with a bake still goes through the worker's own decode word, and a world at 'tiles' asks nothing of any of this.
  ok(text('src/world/horizon/horizonField.ts').includes("w.postMessage({ type: 'decode', id: 1, header: read.header, bin: bin.buffer, tables,"), 'a bake still reaches its worker as a decode');
}

// ---------------------------------------------------------------- the hand-overs only the game makes
{
  const w = text('src/world/world.ts');
  const pin = (s: string, what: string) => ok(w.includes(s), `world.ts: ${what}`);
  pin("if (HORIZON_TUNE.ground === 'tiles' || this.planet.pack !== false || this.planet.space || this.madeHorizonFor === terrain) return;", "with the switch at 'tiles', and on any world with a pack, the arrival makes no rings (the day one's gate)");
  pin('if (this.planet.pack === false && !this.planet.space && !this.planet.instances && !this.terrain.swg) return this.loadMadeHorizon(packId, eye);\n    if (this.planet.space || this.planet.instances || !this.terrain.swg) return;\n    const swg = this.terrain.swg;', "a packless ground world's rings are made, every other world's bake is read as before");
  pin('await this.standMadeHorizon(terrain);\n          if (this.terrain !== terrain) return;\n          // Behind this screen', 'a raster\'s rings made before its ground is made again, so no far tile is built only to be let go');
  pin("if (!planet.ground && !base && HORIZON_TUNE.ground === 'tiles') groundDone();", "the screen waits for a plain world's rings too (and at 'tiles' answers as it did)");
  pin('await this.standMadeHorizon(this.terrain);\n        if (token !== this.loadToken) return null;\n      }\n      // Its lakes of ours', 'a world whose raster is not in this build has its rings on the noise it stands on');
  pin('this.madeHorizonEye = spawn;\n    const pack = await AssetPack.load(this.packId);', 'the windows first stand round the arrival, before anything is awaited');
  pin('} else if (horizon) this.horizonField?.relay(-x1, z0, -x0, z1, this.madeStores, 0, end);', "a stroke relays over a made world's rings, in the raw frame about (0, 0)");
  pin('if (swg) this.horizonField?.courseLater(store.rects, n, swg);\n    else this.horizonField?.courseLater(store.rects, n, this.madeStores);', "a course's change is laid over a made world's rings");
  pin('this.horizonPaint(horizonPaintKeys(false, famKeys, colKeys, null, null));\n    const a = this.rawToGame(x0, z0);', "a paint stroke's tiles composed over a made world's rings");
  pin('const hkm = horizonPaintKeys(familiesMoved, fam, col,', 'a paint landing (an undo, a file) over a made world\'s rings');
  pin('f.paintTiles(keys, this.madePoleGen, this.madeStores);', "its tiles made again by the near ground's own rules");
  pin('if (this.madeMovesWithHeight()) this.horizonPaint(paintKeysOver(-s.x1, s.z0, -s.x0, s.z1));', "a stroke's tiles composed again where a rule or a wash follows the heights");
  pin('if (!swg && h && !field.plain) return this.madeRegenAsks();', "an arrival's paint over a made world's rings");
  pin("if (swg && !swg.farGrid(o.x, o.z, FAR_TILE, FAR_RES, budget === Infinity)) {", 'a made world\'s far cards stand with no far grid');
  pin('samples.surfaceAt = ringCardSurface(f, this.ringHole, o.x, o.z, () => this.viewRadius);\n    fc.tileMade(tx, tz, o.x, o.z, samples);', "a made world's far cards stand on the ring's own surface");
  pin('else this.copyPlainDome(s);', "the horizon fade has a sky on a world with none of the game's");
  pin('field.useShape(shapeSourceOf(madeShapeTerrain(field, this.madeStores)));', 'the shape window is filled from the raster in the worker');
  pin("if ((t.demShader && !ground) || !GROUND_TILES_WANTED) {", "with the tile program off, no rings (the far tiles, today's)");
  const wk = text('src/world/horizon/horizonDecodeWorker.ts');
  ok(wk.includes("m.type === 'make'") && wk.includes('makeBake(g)') && wk.includes('composeBake(b.header') && wk.includes('d.header = b.header;') && wk.includes("m.type === 'poles'"), "the worker makes the rings' sections, hands back the header it made and answers the window's poles");
  const dem = text('src/world/horizon/horizonDem.ts');
  ok(/from '\.\.\/\.\.\/swg\/terrain\/generator\.ts'/.test(dem) && !/from '[^']*(three|main|world)(\.ts)?'/.test(dem), 'horizonDem.ts is pure: nothing of three or the world');
  pin('// for: those the paint reaches, a few a frame (`farCardsAgain`).\n    for (const key of this.cardTileKeys()) {', "a made world's first grass in play takes the cards of the tiles the rings keep too");
}

// ---------------------------------------------------------------- the world's own lines over a made world's rings, run
// (h6b's review round): read out of world.ts as text and run over a stand-in world, never a copy of them in the test.
{
  const W = text('src/world/world.ts').split('\n');
  const method = (name: string): string => {
    const at = W.findIndex((l) => new RegExp(`^  (?:private |async |get )*${name}\\(`).test(l));
    assert.ok(at >= 0, `found ${name}`);
    for (let i = at + 1; i < W.length; i++) if (W[i] === '  }') return W.slice(at, i + 1).join('\n');
    throw new Error(`${name} has no end`);
  };
  const topFn = (name: string): string => {
    const at = W.findIndex((l) => l.startsWith(`function ${name}(`));
    assert.ok(at >= 0, `found ${name}`);
    for (let i = at + 1; i < W.length; i++) if (W[i] === '}') return W.slice(at, i + 1).join('\n');
    throw new Error(`${name} has no end`);
  };
  const constOf = (name: string): number => Number(new RegExp(`^const ${name} = (\\d+);`, 'm').exec(W.join('\n'))![1]);
  const OWN = ['farCardsAgain', 'demFarCards', 'stepFarCards', 'cardTileStands', 'cardTileKeys', 'streamFar', 'streamRingCards', 'releaseRingCards', 'horizonDrawn', 'rebuildGround', 'demFloraLanded', 'endCourseChange', 'composeRingsUnderCourse', 'madeMovesWithHeight', 'horizonPaint', 'standOwedRingCards', 'madeRegenAsks', 'horizonRegenAsks'];
  const src = `${['farCardKey', 'farCardTx', 'farCardTz'].map(topFn).join('\n')}\nclass WorldCards {\n${OWN.map(method).join('\n\n')}\n}\n`;
  const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const FT = constOf('FAR_TILE');
  const WorldCards = new Function('groundChunkOrigin', 'FAR_TILE', 'FAR_RES', 'HORIZON_TUNE', 'ringCardSurface', 'GROUND_REWRITE_TUNE', 'rectMeetsChunk', 'CHUNK_SIZE', 'THREE', 'appearancesNamed', 'paintKeysOverGame', 'madeRegenAsksOf', `${js}\nreturn WorldCards;`)(
    groundChunkOrigin, FT, constOf('FAR_RES'), HORIZON_TUNE, ringCardSurface, GROUND_REWRITE_TUNE, rectMeetsChunk, CHUNK_SIZE, THREE, () => [], paintKeysOverGame, madeRegenAsksOf,
  ) as { prototype: object };
  ok(OWN.every((n) => n in (WorldCards.prototype as Record<string, unknown>)), `the world's own ${OWN.length} methods of a made world's far cards and asks are read out of world.ts and run`);
  const was = { ground: HORIZON_TUNE.ground, ms: GROUND_REWRITE_TUNE.frameMs };
  HORIZON_TUNE.ground = 'rings';
  GROUND_REWRITE_TUNE.frameMs = 1e9;
  try {
    const standing = new Map<string, { surfaceAt?: unknown }>();
    let made = 0;
    const cards = {
      tileMade(tx: number, tz: number, _x: number, _z: number, s: { surfaceAt?: unknown }) {
        standing.set(`${tx},${tz}`, s);
        made++;
      },
      tileGone(tx: number, tz: number) {
        standing.delete(`${tx},${tz}`);
      },
      clear() {
        standing.clear();
      },
      update() {},
    };
    const painted: number[][] = [];
    const field = { header: { source: { made: 'browser' } }, state: { state: 'ready' }, plain: null as unknown, live: { courseWaiting: 0 }, surfaceAt: () => 3, paintTiles(keys: Iterable<number>) { painted.push([...keys]); } };
    type Wd = Record<string, unknown> & { ringCardTiles: Set<string>; farCardsDue: Set<number>; terrain: Record<string, unknown>; madeStores: Record<string, unknown>; [k: string]: unknown };
    const w = Object.assign(Object.create(WorldCards.prototype) as object, {
      terrain: { swg: null, groundShift: NO_SHIFT, tiler: null, releaseFarTile() {}, heights: null, demShader: { groundSpec: { rules: RULES.rules } }, demWash: null },
      planet: { space: false },
      horizonField: field,
      farTiles: new Map(),
      ringCardTiles: new Set<string>(),
      ringCardDebt: new RingCardDebt(),
      farCardsDue: new Set<number>(),
      farCardsAtOnce: false,
      farCards: cards,
      demFlora: { source: { farReaches: () => true, farSamples: () => ({}) }, chunks: 0 },
      flora: {},
      groundPaint: null,
      ringHole: new RingHole(),
      viewRadius: 6,
      ringLastTx: NaN,
      ringLastTz: NaN,
      lastTx: NaN,
      lastTz: NaN,
      lastCx: NaN,
      lastCz: NaN,
      changedN: 0,
      chunks: new Map(),
      streamPcx: 0,
      streamPcz: 0,
      stream() {},
      disposeChunk() {},
      grass: null,
      air: null,
      waterMaterials: [],
      shadowHold: { dirtyAll() {} },
      floraDirty: new Set(),
      floraFlush: false,
      courseRects: [] as { x0: number; z0: number; x1: number; z1: number }[],
      courseRectN: 0,
      courseFocus: { x: 0, z: 0 },
      courseWork: { ends: 0 },
      madeStores: { heights: null, course: null },
      madePoleGen: () => Promise.resolve(null),
    }) as Wd;
    w.ringCardAgain = (tx: number, tz: number) => (w.farCardsAgain as (a: number, b: number) => void).call(w, tx, tz);
    const call = (name: string, ...a: unknown[]) => (w[name] as (...x: unknown[]) => unknown).apply(w, a);
    const R = HORIZON_TUNE.farGridRadius;
    const side = (2 * R + 1) ** 2;
    const eye = new THREE.Vector3(100, 0, 100);
    call('streamFar', eye, Infinity);
    ok(w.ringCardTiles.size === side && w.farCardsDue.size === side && standing.size === 0, `in play a made world's ring tiles queue their cards (${side}), at 'rings' with no far tile drawn`);
    call('stepFarCards', eye);
    ok(standing.size === side && [...w.ringCardTiles].every((k) => standing.has(k)), "and the frame's steps make every one");
    ok([...standing.values()].every((s) => typeof s.surfaceAt === 'function'), "each standing on the ring's own surface");
    // The eye one far tile on: the new column made, the cards and the tiles the rings keep one set.
    eye.x += FT;
    for (let k = 0; k < side; k++) call('streamFar', eye, 1);
    call('stepFarCards', eye);
    const ptx = Math.floor(eye.x / FT);
    const ptz = Math.floor(eye.z / FT);
    let window = true;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) if (!standing.has(`${ptx + dx},${ptz + dz}`)) window = false;
    ok(window && standing.size === w.ringCardTiles.size && [...w.ringCardTiles].every((k) => standing.has(k)), `the eye moved a far tile, every tile round it carries its cards (${standing.size})`);
    // The ground made again (a families-moving paint landing, a late paint file, a world row's switch): the cards made again.
    w.streamPcx = Math.floor(eye.x / CHUNK_SIZE);
    w.streamPcz = Math.floor(eye.z / CHUNK_SIZE);
    call('rebuildGround');
    ok(standing.size === 0 && w.farCardsDue.size === side, 'the ground made again lets every card go and queues the window again');
    call('stepFarCards', eye);
    ok(standing.size === side && [...w.ringCardTiles].every((k) => standing.has(k)), 'and the cards stand again over it');
    // A flora paint landing: every ring tile it meets queued and made again.
    const before = made;
    call('demFloraLanded', [], [{ x0: eye.x - 4 * FT, z0: eye.z - 4 * FT, x1: eye.x + 4 * FT, z1: eye.z + 4 * FT }]);
    call('stepFarCards', eye);
    ok(made - before === w.ringCardTiles.size, `a flora paint landing makes the cards of every ring tile it meets again (${made - before})`);
    // A course's change ends: a ruled world's rings composed again under it, a plain one's not.
    w.courseRects = [{ x0: 10, z0: -50, x1: 700, z1: -30 }];
    w.courseRectN = 1;
    call('endCourseChange');
    ok(painted.length === 1 && painted[0].join() === paintKeysOver(-700, -50, -10, -30).join(), "a course's change on a ruled made world composes the rings' tiles under it again");
    (w.terrain as { demShader: unknown }).demShader = { groundSpec: { rules: [] } };
    w.courseRects = [{ x0: 10, z0: -50, x1: 700, z1: -30 }];
    w.courseRectN = 1;
    call('endCourseChange');
    ok(painted.length === 1, "and on a world whose families follow no height, nothing");
    (w.terrain as { demShader: unknown }).demShader = { groundSpec: { rules: RULES.rules } };
    // The arrival's asks: the kept edits and the drawn course on a ruled world, nothing on a plain one.
    const course = new CourseCarve();
    course.set([straight('h6bw', -200, 200, -40, 11, { w: 6, sh: 6 })]);
    const edits = new HeightEdits();
    edits.set(20, 3, new Float32Array(HEIGHT_TILE_DELTAS).fill(4));
    w.terrain.heights = edits;
    w.madeStores = { heights: edits, course };
    const asks = (await call('horizonRegenAsks', field, 'testworld')) as { x0: number; z0: number; x1: number; z1: number }[];
    const covers = (x: number, z: number) => asks.some((a) => x >= a.x0 && x <= a.x1 && z >= a.z0 && z <= a.z1);
    ok(covers(1300, 220) && course.cells().every(([cx, cz]) => covers((cx + 0.5) * CARVE_BUCKET, (cz + 0.5) * CARVE_BUCKET)), `an arrival on a ruled made world composes again its edits' and its course's tiles (${asks.length})`);
    field.plain = {};
    ok(((await call('horizonRegenAsks', field, 'testworld')) as unknown[]).length === 0, 'and on a plain one nothing');
  } finally {
    HORIZON_TUNE.ground = was.ground;
    GROUND_REWRITE_TUNE.frameMs = was.ms;
  }
}

// A real raster, read-only where the checkout holds it: Helensar's, at 16 m (a world with nothing of the owner's on it).
{
  const dir = resolve(REPO, 'public/dem/helens');
  if (existsSync(`${dir}/base16.raw`)) {
    const meta = JSON.parse(readFileSync(`${dir}/base.json`, 'utf8')) as DemMeta;
    const rawB = readFileSync(`${dir}/base16.raw`);
    const raw = rawB.buffer.slice(rawB.byteOffset, rawB.byteOffset + rawB.byteLength) as ArrayBuffer;
    const lift = -299.8861083984375;
    const size = 24576;
    const w2 = { size, lift, feather: 0 };
    const hel = planetOf({ base: 0, amplitude: 16, frequency: 0.0038, octaves: 4, ridged: 0.6, flatten: 1.1, detail: 0 }, 0.5, 4001);
    const t = new Terrain(hel);
    t.dem = makeDemPatch(raw, meta, w2);
    const g = new MadeGround(specOf({ size, source: { raw, meta, where: w2 }, lift, terrain: hel.terrain as MadeNoise, seed: 4001 }));
    const b = makeBake(g);
    ok(b.header.fine.step === 16 && b.header.fine.nx === 1665, "Helensar's raster stands at 16 m, 1,665 a side");
    ok(anySamples(b.header.fine, (rx, rz, k) => Object.is(b.fine[k], Math.fround(t.groundRawAt(-rx, rz)))), "every sample of its rings is its Terrain's own ground (no detail), read from its own raster");
  } else note("Helensar's raster is not on this disk: its 16 m check left out");
}

void HORIZON_TUNE;
void tileTablesOf;
console.log(`\n${checks} checks passed`);
