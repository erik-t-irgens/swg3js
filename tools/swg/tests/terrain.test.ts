import { form, chunk, W, encode, encodeRoots, ihdr, mfrc } from './iffWriter.ts';
import { parseTerrainTemplate, parseLayerFile, TerrainSampler, sampleFans, ORIGIN_OFFSET, attachBitmap } from '../../../src/swg/terrain/trn.ts';
import { MultiFractal } from '../../../src/swg/terrain/fractal.ts';

// Synthetic end-to-end test of the terrain port: builds a small .trn and .lay in memory,
// generates chunks and checks heights against hand-computed expectations. Also pins the
// fractal noise to values produced by the engine's own C++ (single precision).
// Run: node tools/swg/tests/terrain.test.ts

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); };
const near = (a: number, b: number, eps = 1e-4) => Math.abs(a - b) <= eps;

// --- fractal noise against the engine's C++ (RandomGenerator stream and MultiFractal samples)
{
  const { RandomGenerator } = await import('../../../src/swg/terrain/fractal.ts');
  const r = new RandomGenerator();
  r.setSeed(12345);
  const stream = Array.from({ length: 8 }, () => r.random());
  check('ran1 stream', stream.join(' ') === '209567120 451350201 440185056 109072277 1552920794 963885229 518192746 65796851', stream.join(' '));
  const params: [number, number, number, number, number, number, number, number, number, number, number, number, number][] = [
    [0, 0.01, 0.01, 0, 0, 2, 4, 0.5, 0, 0.5, 0, 0.7, 0],
    [1337, 0.003, 0.003, 100, -50, 4, 2.2, 0.45, 1, 0.3, 0, 0.7, 0],
    [42, 0.02, 0.05, 0, 0, 3, 3, 0.6, 0, 0.5, 1, 0.8, 2],
    [99999, 0.008, 0.008, 12.5, 7.25, 5, 2, 0.5, 1, 0.6, 1, 0.4, 3],
    [7, 0.05, 0.05, 0, 0, 1, 4, 0.5, 0, 0, 0, 0, 4],
    [3000000000, 0.01, 0.02, -3, 9, 2, 4, 0.5, 0, 0, 0, 0, 5],
  ];
  const expected = [
    [0.5, 0.5207921, 0.5567579, 0.3312793, 0.5270576, 0.5, 0.4764443, 0.5, 0.5, 0.5069896, 0.498574, 0.5016289],
    [0.2950946, 0.2468807, 0.2712392, 0.2061535, 0.3731089, 0.2581292, 0.3127683, 0.3027317, 0.2991301, 0.2986715, 0.3236467, 0.2689026],
    [1, 0.9953734, 0.9859496, 0.8671637, 0.9763015, 1, 0.9092529, 1, 1, 0.9981064, 0.9999989, 0.9988055],
    [0.4431001, 0.2823859, 0.177594, 0.4091271, 0.2836719, 0.4536025, 0.2575991, 0.1776702, 0.1880736, 0.2028662, 0.2534643, 0.2328829],
    [1, 0.9708064, 0.8300014, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [0, 0.0668363, 0, 0.0166988, 0, 0, 0.0798876, 0, 0, 0.0016624, 0, 0.016051],
  ];
  const xs = [0, 1.5, -2000.25, 3528, 7777.7, -8000, 123.456, 5000];
  const ys = [0, -4804, 17, 2222.2, -1, 8000, 654.321, -5000];
  params.forEach((p, k) => {
    const m = new MultiFractal();
    m.setCombinationRule(p[12]);
    m.setSeed(p[0]);
    m.setScale(Math.fround(p[1]), Math.fround(p[2]));
    m.setOffset(p[3], p[4]);
    m.setNumberOfOctaves(p[5]);
    m.setFrequency(Math.fround(p[6]));
    m.setAmplitude(Math.fround(p[7]));
    m.setBias(!!p[8], Math.fround(p[9]));
    m.setGain(!!p[10], Math.fround(p[11]));
    const got = [...xs.map((x, i) => m.value2(Math.fround(x), Math.fround(ys[i]))), ...xs.slice(0, 4).map((x) => m.value1(Math.fround(x)))];
    const worst = Math.max(...got.map((v, i) => Math.abs(v - expected[k][i])));
    check(`fractal reference set ${k}`, worst <= 2e-7, `worst ${worst}`);
  });
}

// --- build a synthetic .trn: fractal family 1, layer A: AHFR add scaleY 50 everywhere,
//     sublayer B: circle (100,100,r=40, feather 0.5 easeIn) with AHCN replace (height set to 7)
//     layer C: rectangle 200..260 x -50..10, slope filter (0..10 deg) with AHCN add 3
const header = new W().str('test').f32(1024).f32(32).i32(8).i32(0).f32(0).f32(2).str('').f32(60)
  .f32(0).f32(0).f32(0).f32(0).u32(0).f32(0).f32(0).f32(0).f32(0).u32(0).f32(0).f32(0).f32(0).f32(0).u32(0).f32(0).f32(0).f32(0).f32(0).u32(0).u8(0).bytes();
const sgrp = form('SGRP', form('0006', chunk('SFAM', new W().i32(1).str('sand').str('').u8(1).u8(2).u8(3).f32(2).f32(0.5).i32(1).str('shader/x.sht').f32(1).bytes())));
const mgrp = form('MGRP', form('0000', form('MFAM', chunk('DATA', new W().i32(1).str('hills').bytes()), mfrc(1337, { oct: 3, freq: 2, amp: 0.5, sx: 0.02, sy: 0.02 }))));
const ahfr = form('AHFR', form('0003', ihdr('hills'), form('DATA', chunk('PARM', new W().i32(1).i32(1).f32(50).bytes()))));
const bcir = form('BCIR', form('0002', ihdr('circle'), chunk('DATA', new W().f32(100).f32(100).f32(40).i32(1).f32(0.5).bytes())));
const ahcn = (op: number, h: number) => form('AHCN', form('0000', ihdr('flat'), chunk('DATA', new W().i32(op).f32(h).bytes())));
const subB = form('LAYR', form('0003', ihdr('B'), chunk('ADTA', new W().i32(0).i32(0).i32(1).str('').bytes()), bcir, ahcn(0, 7)));
const layerA = form('LAYR', form('0003', ihdr('A'), chunk('ADTA', new W().i32(0).i32(0).i32(1).str('').bytes()), ahfr, subB));
const brec = form('BREC', form('0004', ihdr('rect'), chunk('DATA', new W().f32(200).f32(-50).f32(260).f32(10).i32(0).f32(0).i32(0).i32(0).f32(0).f32(2).str('').i32(0).bytes())));
const fslp = form('FSLP', form('0002', ihdr('slope'), chunk('DATA', new W().f32(0).f32(89).i32(0).f32(0).bytes())));
const ascn = form('ASCN', form('0001', ihdr('sand'), chunk('DATA', new W().i32(1).i32(0).f32(1).bytes())));
const layerC = form('LAYR', form('0003', ihdr('C'), chunk('ADTA', new W().i32(0).i32(0).i32(1).str('').bytes()), brec, fslp, ahcn(1, 3), ascn));
const tgen = form('TGEN', form('0000', sgrp, form('FGRP', form('0008')), form('RGRP', form('0003')), form('EGRP', form('0002')), mgrp, form('LYRS', layerA, layerC)));
const trn = encode(form('PTAT', form('0015', chunk('DATA', header), tgen, form('BAKE'))));

const t = parseTerrainTemplate(trn);
check('header', t.name === 'test' && t.mapWidthInMeters === 1024 && t.chunkWidthInMeters === 32 && t.numberOfTilesPerChunk === 8 && t.tileWidthInMeters === 4);
check('summary', JSON.stringify(t.generator.summary()) === JSON.stringify({ LAYR: 3, AHFR: 1, BCIR: 1, AHCN: 2, BREC: 1, FSLP: 1, ASCN: 1 }), JSON.stringify(t.generator.summary()));
check('shader family', t.generator.shaderGroup.featherClamp(1) === 0.5);
const fam = t.generator.fractalGroup.get(1)!;
check('fractal family', fam.numberOfOctaves === 3 && near(fam.scaleX, 0.02) && fam.seed === 1337);

const s = new TerrainSampler(t);
// far from the circle and rectangle: height = 50 * fractal
const ref = new MultiFractal(); ref.setSeed(1337); ref.setNumberOfOctaves(3); ref.setFrequency(2); ref.setAmplitude(0.5); ref.setScale(Math.fround(0.02), Math.fround(0.02));
const expectAt = (x: number, z: number) => 50 * ref.value2(x, z);
for (const [x, z] of [[0, 0], [-500, 300], [30, -30]]) check(`fractal height ${x},${z}`, near(s.heightAt(x, z), expectAt(x, z), 1e-3), `${s.heightAt(x, z)} vs ${expectAt(x, z)}`);
// pole-exact sampling: a pole position equals the grid value
const g = s.generateBlock(3, -2).heights;
const st = s.blockStart(3, -2);
const px = st.x + 7 * s.poleStep, pz = st.z + 9 * s.poleStep;
check('pole exact', near(s.heightAt(px, pz), g[9 * s.numberOfPoles + 7], 1e-6));
// inside the circle core (radius*(1-feather)=20): flattened to 7
check('circle core', near(s.heightAt(100, 100), 7, 1e-6), String(s.heightAt(100, 100)));
check('circle core edge', near(s.heightAt(118, 100), 7, 1e-6), String(s.heightAt(118, 100)));
// in the feather band: between 7 and fractal. at distance 30: amount = 1 - (900-400)/(1600-400) = 0.5833, easeIn -> 0.3403
{
  const x = 130, z = 100; // exactly a pole (multiple of 2)
  const a = 1 - (900 - 400) / (1600 - 400); const amt = a * a;
  const exp = amt * 7 + (1 - amt) * expectAt(x, z);
  check('circle feather', near(s.heightAt(x, z), exp, 1e-3), `${s.heightAt(x, z)} vs ${exp}`);
}
check('outside circle', near(s.heightAt(150, 100), expectAt(150, 100), 1e-3));
// rectangle + slope filter: flat-ish ground gets +3 where slope < 10 deg. Check a pole inside and compare with normal
{
  const x = 230, z = -20;
  const h = s.heightAt(x, z);
  const base = expectAt(x, z);
  check('rect slope affector applies', near(h, base + 3, 1e-3), `${h} vs base ${base}`);
  // shader map inside rect where affected should be family 1
  const grid = s.generate(224 - 2 * 2, -32 - 2 * 2, s.numberOfPoles, s.poleStep);
  const idx = (ORIGIN_OFFSET + 3) * s.numberOfPoles + (ORIGIN_OFFSET + 3); // pole at (230, -26)
  check('shader constant', grid.shaders[idx] === 1, `shader ${grid.shaders[idx]}`);
}
// sampleFans on a plane reproduces the plane exactly
{
  const n = 20, tiles = 8, tw = 4; const h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = 0.5 * (i - 2) * 2 + 0.25 * (j - 2) * 2 + 3;
  let worst = 0;
  for (let k = 0; k < 200; k++) { const x = Math.random() * 32, z = Math.random() * 32; worst = Math.max(worst, Math.abs(sampleFans(h, n, tiles, tw, x, z) - (0.5 * x + 0.25 * z + 3))); }
  check('fan plane', worst < 1e-4, `worst ${worst}`);
}
// building layer: .lay with rectangle -10..10 and AHCN replace 0; placed at (300,300) rotated 45 deg; ground becomes base height at centre
{
  const lay = encodeRoots([form('SGRP', form('0006')), form('FGRP', form('0008')), form('RGRP', form('0003')), form('EGRP', form('0002')), form('MGRP', form('0000')),
    form('LAYR', form('0003', ihdr('bld'), chunk('ADTA', new W().i32(0).i32(0).i32(1).str('').bytes()),
      form('BREC', form('0004', ihdr('r'), chunk('DATA', new W().f32(-10).f32(-10).f32(10).f32(10).i32(0).f32(0).i32(0).i32(0).f32(0).f32(2).str('').i32(0).bytes()))),
      ahcn(0, 0)))]);
  const layer = parseLayerFile(lay, t.generator)!;
  check('lay parsed', !!layer && layer.boundaries.length === 1 && layer.affectors.length === 1);
  const centreBase = s.baseHeightAt(300, 300);
  s.addBuildingLayer(layer, 300, 300, Math.PI / 4);
  check('building centre', near(s.heightAt(300, 300), centreBase, 1e-3), `${s.heightAt(300, 300)} vs ${centreBase}`);
  // along the rotated rectangle axis (45 deg): point 12 m diagonal is inside (local coords 12*cos45.. ~8.5 < 10)
  // world (306,300) -> local (4.24, 4.24): inside the rotated rectangle
  check('building inside rotated', near(s.heightAt(306, 300), centreBase, 1e-3), String(s.heightAt(306, 300) - centreBase));
  // world (309,309) -> local (0, 12.7): outside once rotated, though inside an unrotated rectangle
  const off = s.heightAt(310, 310);
  check('building outside rotated', near(off, expectAt(310, 310), 1e-3), `${off} vs ${expectAt(310, 310)}`);
  // base height ignores the building layer
  check('baseHeightAt excludes buildings', near(s.baseHeightAt(300, 300), centreBase, 1e-6));
}
// timing
{
  // --- bitmap filter: a layer subtracting 2 m scaled by a greyscale image over its rectangle
{
  const { BitmapGroup } = await import('../../../src/swg/terrain/generator.ts');
  const bgrp = form('MGRP', form('0000', form('MFAM', chunk('DATA', new W().i32(1).str('mos').str('terrain/mos.tga').bytes()))));
  const brec2 = form('BREC', form('0004', ihdr('r'), chunk('DATA', new W().f32(1000).f32(1000).f32(1256).f32(1256).i32(0).f32(0).i32(0).i32(0).f32(0).f32(2).str('').i32(0).bytes())));
  const fbit = form('FBIT', form('0001', ihdr('b'), form('DATA', chunk('PARM', new W().i32(1).i32(0).f32(0).f32(0).f32(1).f32(0).bytes()))));
  const adta2 = chunk('ADTA', new W().i32(0).i32(0).i32(1).str('').bytes());
  const layer = form('LAYR', form('0003', ihdr('hm'), adta2, brec2, fbit, ahcn(2, 2)));
  const trn2 = encode(form('PTAT', form('0015', chunk('DATA', header), form('TGEN', form('0000', form('SGRP', form('0006')), form('FGRP', form('0008')), form('RGRP', form('0003')), form('EGRP', form('0002')), form('MGRP', form('0000')), bgrp, form('LYRS', layer))), form('BAKE'))));
  const t2 = parseTerrainTemplate(trn2);
  check('bitmap group parsed', t2.generator.bitmapGroup.families.get(1)?.bitmapName === 'terrain/mos.tga');
  // 4x4 image, rows top-down: bottom row (world z near 1000) is 255, top row is 0
  const img = new Uint8Array(16);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) img[y * 4 + x] = y === 3 ? 255 : y === 2 ? 128 : 0;
  const hm = new Uint8Array(12 + 16);
  hm.set([72, 77, 65, 80, 4, 0, 0, 0, 4, 0, 0, 0]);
  hm.set(img, 12);
  check('bitmap attached', attachBitmap(t2, 1, hm));
  const s2 = new TerrainSampler(t2);
  const hLow = s2.heightAt(1002, 1002); // bottom-left pixel = 255 -> subtract ~2
  const hHigh = s2.heightAt(1002, 1250); // top row = 0 -> no change
  check('bitmap filter scales the affector', hLow < -1.9 && hLow > -2.01 && Math.abs(hHigh) < 1e-6, `${hLow} ${hHigh}`);
  const without = new TerrainSampler(parseTerrainTemplate(trn2));
  check('missing bitmap passes fully', Math.abs(without.heightAt(1002, 1250) + 2) < 1e-6, String(without.heightAt(1002, 1250)));
}

// --- flora: a family with two weighted children, planted by AFSC/AFSN inside a rectangle; a lake rectangle
{
  const { FloraGroup, FastRandomGenerator, PackedIntegerMap, hashTuple, hashFloat } = await import('../../../src/swg/terrain/flora.ts');
  const { waterTables } = await import('../../../src/swg/terrain/trn.ts');
  const child = (name: string, weight: number, scale: boolean) => new W().str(name).f32(weight).i32(0).f32(0).f32(0).i32(0).i32(scale ? 1 : 0).f32(0.8).f32(1.2);
  const ffam = new W().i32(1).str('trees').u8(10).u8(20).u8(30).f32(1).i32(0).i32(2).bytes();
  const ffamAll = new Uint8Array([...ffam, ...child('appearance/tree_a.apt', 1, true).bytes(), ...child('appearance/tree_b.apt', 3, false).bytes()]);
  const ffamBare = new Uint8Array([...new W().i32(2).str('shrubs').u8(1).u8(2).u8(3).f32(1).i32(0).i32(1).bytes(), ...child('shrb_dsrt_brown.apt', 1, false).bytes()]);
  const fgrp = form('FGRP', form('0008', chunk('FFAM', ffamAll), chunk('FFAM', ffamBare)));
  const floraRect = form('BREC', form('0004', ihdr('grove'), chunk('DATA', new W().f32(0).f32(0).f32(64).f32(64).i32(0).f32(0).i32(0).i32(0).f32(0).f32(2).str('').i32(0).bytes())));
  const afsc = (tag: string) => form(tag, form('0004', ihdr('plant'), chunk('DATA', new W().i32(1).i32(1).i32(0).i32(1).f32(1).bytes())));
  const lake = form('BREC', form('0004', ihdr('lake'), chunk('DATA', new W().f32(100).f32(100).f32(200).f32(200).i32(0).f32(0).i32(1).i32(0).f32(12).f32(2).str('shader/water.sht').i32(0).bytes())));
  const grove = form('LAYR', form('0003', ihdr('grove'), chunk('ADTA', new W().i32(0).i32(0).i32(1).str('').bytes()), floraRect, afsc('AFSC'), afsc('AFSN')));
  const lakeLayer = form('LAYR', form('0003', ihdr('lake'), chunk('ADTA', new W().i32(0).i32(0).i32(1).str('').bytes()), lake));
  const tgen3 = form('TGEN', form('0000', sgrp, fgrp, form('RGRP', form('0003')), form('EGRP', form('0002')), mgrp, form('LYRS', grove, lakeLayer)));
  const t3 = parseTerrainTemplate(encode(form('PTAT', form('0015', chunk('DATA', header), tgen3, form('BAKE')))));
  const fam = t3.generator.floraGroup.families.get(1);
  check('flora group parsed', !!fam && fam.name === 'trees' && fam.children.length === 2 && fam.children[0].shouldScale && fam.children[0].maxScale > 1.19 && fam.children[1].appearance === 'appearance/tree_b.apt', JSON.stringify(fam));
  check('flora bare names live in appearance/', t3.generator.floraGroup.families.get(2)?.children[0].appearance === 'appearance/shrb_dsrt_brown.apt');
  check('flora weighted choice', t3.generator.floraGroup.createFlora(1, 0.1)?.appearance === 'appearance/tree_a.apt' && t3.generator.floraGroup.createFlora(1, 0.9)?.appearance === 'appearance/tree_b.apt');
  check('flora affectors known', t3.generator.summary().AFSC === 1 && t3.generator.summary().AFSN === 1, JSON.stringify(t3.generator.summary()));
  const s3 = new TerrainSampler(t3);
  const inside = s3.floraAt(10, 10, true);
  const insideN = s3.floraAt(30, 20, false);
  const outside = s3.floraAt(300, 300, true);
  check('flora planted inside the rectangle', inside.family === 1 && insideN.family === 1 && inside.choice >= 0 && inside.choice <= 1, JSON.stringify([inside, insideN]));
  check('no flora outside', outside.family === 0);
  check('flora deterministic', s3.floraAt(10, 10, true).choice === inside.choice);
  const tables = waterTables(t3.generator);
  check('water table found', tables.length === 1 && tables[0].height === 12 && tables[0].points.length === 4 && tables[0].name === 'lake', JSON.stringify(tables));
  check('flora tiling header', t3.flora.collidable.tileSize === 0 && t3.flora.legacyMap === false);
  // packed integer map: width 4, 3 bits, values 5 2 7 1 packed LSB first -> bytes 213, 3
  const { parseIff } = await import('../../../src/swg/terrain/iff.ts');
  const pimpParsed = new PackedIntegerMap(parseIff(encode(form('PIMP', form('0000', chunk('CNTL', new W().i32(4).i32(1).i32(3).i32(0).bytes()), chunk('DATA', new Uint8Array([213, 3])))))));
  check('packed map', [0, 1, 2, 3].map((x) => pimpParsed.getValue(x, 0)).join() === '5,2,7,1', [0, 1, 2, 3].map((x) => pimpParsed.getValue(x, 0)).join());
  check('fast random', new FastRandomGenerator(1).random() === 16807 && new FastRandomGenerator(1).randomFloat() < 1e-4);
  const h = hashFloat(hashTuple(1, 2));
  check('coordinate hash', h >= 0 && h < 1 && hashTuple(1, 2) !== hashTuple(2, 1) && hashTuple(1, 2) === hashTuple(1, 2), String(h));
}

// --- water tables: each one's own shader, water type and shader size, and the list of shaders a
//     terrain draws water with (the global sea's and every lake's, keyed one way).
{
  const { waterTables, waterShaderUses, shaderKey } = await import('../../../src/swg/terrain/trn.ts');
  type Item = ReturnType<typeof form>;
  const waterHeader = (useGlobal: number, shader: string) => new W().str('test').f32(1024).f32(32).i32(8).i32(useGlobal).f32(9).f32(3).str(shader).f32(60)
    .f32(0).f32(0).f32(0).f32(0).u32(0).f32(0).f32(0).f32(0).f32(0).u32(0).f32(0).f32(0).f32(0).f32(0).u32(0).f32(0).f32(0).f32(0).f32(0).u32(0).u8(0).bytes();
  // BREC version 4: rect, feather, local water table, local-global flag, height, shader size, shader, water type.
  const rect = (name: string, shader: string) => form('BREC', form('0004', ihdr(name), chunk('DATA', new W().f32(100).f32(100).f32(200).f32(200).i32(0).f32(0).i32(1).i32(0).f32(12).f32(2).str(shader).i32(0).bytes())));
  // BPOL version 7: point count, points, feather, local water table, height, shader size, water type, shader.
  const lavaPoly = form('BPOL', form('0007', ihdr('flow'), chunk('DATA', new W().i32(3).f32(0).f32(0).f32(40).f32(0).f32(0).f32(40).i32(0).f32(0).i32(1).f32(3).f32(4).i32(1).str('shader\\Wter_Lava_01_Still.sht').bytes())));
  const layerOf = (name: string, item: Item) => form('LAYR', form('0003', ihdr(name), chunk('ADTA', new W().i32(0).i32(0).i32(1).str('').bytes()), item));
  const build = (h: Uint8Array, ...layers: Item[]) => parseTerrainTemplate(encode(form('PTAT', form('0015', chunk('DATA', h),
    form('TGEN', form('0000', sgrp, form('FGRP', form('0008')), form('RGRP', form('0003')), form('EGRP', form('0002')), mgrp, form('LYRS', ...layers))), form('BAKE')))));
  const layers = [layerOf('a', rect('lake', 'shader\\Wter_Spec.sht')), layerOf('b', lavaPoly), layerOf('c', rect('nameless', ''))];
  const tw = build(waterHeader(1, 'shader\\Wter_Spec.sht'), ...layers);
  const tables = waterTables(tw.generator);
  const lake = tables.find((t) => t.name === 'lake');
  const flow = tables.find((t) => t.name === 'flow');
  check('water tables carry their shader, type and size', tables.length === 3 && !!lake && lake.shader === 'wter_spec' && lake.waterType === 0 && lake.shaderSize === 2 && lake.height === 12, JSON.stringify(tables.map((t) => ({ n: t.name, s: t.shader, w: t.waterType, z: t.shaderSize }))));
  check('a lava polygon reads its water type and shader size', !!flow && flow.shader === 'wter_lava_01_still' && flow.waterType === 1 && flow.shaderSize === 4 && flow.height === 3 && flow.points.length === 3, JSON.stringify(flow));
  const uses = waterShaderUses(tw);
  check('water shader uses are merged, sorted and keyed one way', JSON.stringify(uses) === JSON.stringify([
    { shader: 'wter_lava_01_still', waterTypes: [1], tables: 1, global: false },
    { shader: 'wter_spec', waterTypes: [0], tables: 1, global: true },
  ]), JSON.stringify(uses));
  const noGlobalName = waterShaderUses(build(waterHeader(1, ''), ...layers));
  check('a global table with no shader name is left out', noGlobalName.length === 2 && noGlobalName.every((u) => !u.global), JSON.stringify(noGlobalName));
  const noGlobal = waterShaderUses(build(waterHeader(0, 'shader\\Wter_Spec.sht'), ...layers));
  check('a terrain that does not use its global table does not list its shader', noGlobal.length === 2 && !noGlobal.some((u) => u.global), JSON.stringify(noGlobal));
  const dry = waterShaderUses(build(waterHeader(0, ''), layerOf('c', rect('nameless', ''))));
  check('a terrain with no named water shader uses none', dry.length === 0, JSON.stringify(dry));
  check('shaderKey strips the folder and the extension and lowers the case', [shaderKey('shader\\Wter_Spec.sht'), shaderKey('shader/x.sht'), shaderKey('WTER_SPEC'), shaderKey('')].join() === 'wter_spec,x,wter_spec,');
}

// --- environment families (EGRP) and the affectors that paint them (AENV), evaluated like
//     shader constants: a base layer everywhere, a town circle, a seasonal circle inside it.
{
  const efam = (id: number, name: string, clamp: number) => form('EFAM', chunk('DATA', new W().i32(id).str(name).u8(1).u8(2).u8(3).f32(clamp).bytes()));
  const egrp = form('EGRP', form('0002', efam(1, 'global', 1), efam(2, 'Town', 0.5), efam(3, 'LifeDay', 1)));
  const aenv = (name: string, family: number, override = 0, clamp = 1) => form('AENV', form('0000', ihdr(name), chunk('DATA', new W().i32(family).i32(override).f32(clamp).bytes())));
  const adta = () => chunk('ADTA', new W().i32(0).i32(0).i32(1).str('').bytes());
  const circle = (name: string, x: number, z: number, r: number, feath: number) => form('BCIR', form('0002', ihdr(name), chunk('DATA', new W().f32(x).f32(z).f32(r).i32(0).f32(feath).bytes())));
  const makeTrn = (townOverride: boolean) => {
    const everywhere = form('LAYR', form('0003', ihdr('G'), adta(), aenv('base', 1)));
    const town = form('LAYR', form('0003', ihdr('T'), adta(), circle('town', 100, 100, 40, 0.5), aenv('town', 2, townOverride ? 1 : 0, 1)));
    const party = form('LAYR', form('0003', ihdr('L'), adta(), circle('party', 100, 100, 10, 0), aenv('party', 3)));
    const bad = form('LAYR', form('0003', ihdr('X'), adta(), aenv('nonsense', 300)));
    const tgenE = form('TGEN', form('0000', sgrp, form('FGRP', form('0008')), form('RGRP', form('0003')), egrp, mgrp, form('LYRS', everywhere, town, party, bad)));
    return parseTerrainTemplate(encode(form('PTAT', form('0015', chunk('DATA', header), tgenE, form('BAKE')))));
  };
  const te = makeTrn(false);
  const eg = te.generator.environmentGroup;
  check('environment families parsed', eg.families.size === 3 && eg.byName('town')?.id === 2 && eg.isSeasonal(3) && !eg.isSeasonal(2) && eg.featherClamp(2) === 0.5, JSON.stringify([...eg.families.values()]));
  {
    // A family record that ends early must not read past it: without a guard the colour would be
    // three undefined bytes in a triple typed as numbers.
    const { EnvironmentGroup } = await import('../../../src/swg/terrain/generator.ts');
    const { parseIff } = await import('../../../src/swg/terrain/iff.ts');
    const g = new EnvironmentGroup();
    g.load(parseIff(encode(form('EGRP', form('0002', form('EFAM', chunk('DATA', new W().i32(9).str('short').bytes())))))));
    const fam = g.families.get(9);
    check('a truncated environment family reads without undefined bytes', !!fam && fam.name === 'short' && fam.color.every((c) => Number.isFinite(c)) && fam.featherClamp === 1, JSON.stringify(fam));
  }
  const se = new TerrainSampler(te);
  check('environment base layer covers the map', se.environmentAt(0, 0) === 1 && se.environmentAt(-400, 300) === 1, `${se.environmentAt(0, 0)} ${se.environmentAt(-400, 300)}`);
  check('environment circle paints its family', se.environmentAt(100, 100) === 2 && se.environmentAt(120, 100) === 2, `${se.environmentAt(100, 100)} ${se.environmentAt(120, 100)}`);
  check('seasonal area kept in its own map', se.environmentAt(100, 100, true) === 3 && se.environmentAt(100, 100) === 2 && se.environmentAt(120, 100, true) === 2, `${se.environmentAt(100, 100, true)} ${se.environmentAt(120, 100, true)}`);
  check('feather under the family clamp leaves the pole alone', se.environmentAt(134, 100) === 1, String(se.environmentAt(134, 100)));
  const so = new TerrainSampler(makeTrn(true));
  check('feather clamp override narrows the area', so.environmentAt(120, 100) === 2 && so.environmentAt(130, 100) === 1, `${so.environmentAt(120, 100)} ${so.environmentAt(130, 100)}`);
  check('an out-of-range family is noted once and paints nothing', te.generator.unknownTags.size === 1 && [...te.generator.unknownTags.keys()][0].includes('300'), JSON.stringify([...te.generator.unknownTags]));
  check('environment affectors counted', te.generator.summary().AENV === 4, JSON.stringify(te.generator.summary()));
  const described = te.generator.describe().filter((l) => l.includes('AENV'));
  check('describe names the families', described.some((l) => l.includes('family 2=Town') && !l.includes('seasonal')) && described.some((l) => l.includes('family 3=LifeDay seasonal')), described.join(' | '));
  const areas = te.generator.environmentAreas();
  const townArea = areas.find((a) => a.name === 'Town');
  check('environment areas report their extent', !!townArea && townArea.active && townArea.extent?.x0 === 60 && townArea.extent?.x1 === 140 && areas.some((a) => a.name === 'LifeDay' && a.seasonal) && areas.some((a) => a.name === 'global' && a.extent === null), JSON.stringify(areas));
  // A building's own layer file carries its own family list, which nothing remaps onto the planet's,
  // so its environment affector must be counted and then leave the planet's map alone.
  {
    const before = se.environmentAt(-300, -300);
    const lay = encodeRoots([form('SGRP', form('0006')), form('FGRP', form('0008')), form('RGRP', form('0003')),
      form('EGRP', form('0002', efam(2, 'the file\'s own family', 1))), form('MGRP', form('0000')),
      form('LAYR', form('0003', ihdr('bld'), adta(), circle('bld', 0, 0, 40, 0), aenv('bld', 2)))]);
    const layer = parseLayerFile(lay, te.generator)!;
    se.addBuildingLayer(layer, -300, -300, 0);
    check('a layer file\'s environment affector is counted and paints nothing', se.environmentAt(-300, -300) === before && before === 1 && te.generator.unknownTags.size === 2, `${se.environmentAt(-300, -300)} vs ${before}; ${JSON.stringify([...te.generator.unknownTags.keys()])}`);
  }
}

const t0 = performance.now(); let c = 0;
  for (let cz = -5; cz < 5; cz++) for (let cx = -5; cx < 5; cx++) { s.generate(cx * 32 - 4, cz * 32 - 4, s.numberOfPoles, s.poleStep); c++; }
  console.log(`generated ${c} chunks in ${(performance.now() - t0).toFixed(1)} ms (${((performance.now() - t0) / c).toFixed(2)} ms/chunk, ${s.numberOfPoles}x${s.numberOfPoles} poles)`);
}
console.log(failures ? `${failures} FAILURES` : 'all passed');
process.exit(failures ? 1 : 0);
