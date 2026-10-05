// The colour map the client tinted its ground with, painted by the terrain's own colour affectors
// (materials and ground pass, wave 2), and the worker's messages that carry it.
//
// The map starts white. A constant (ACCN) lays one colour; a fractal ramp (ACRF) looks a one-row ramp up
// at the whole-number position a fractal's value gives it; a height ramp (ACRH) does the same by the
// ground's height, only inside its inclusive range and at the height as it stands when it runs. Each
// combines with what is there in single precision, truncated to a byte, and "multiply" is not a multiply:
// it fades toward the average of the old and the new. Every check is of the colours the generator writes:
//
//   1. a terrain built in memory: each operation at full strength by hand, and add and subtract at a
//      partial amount by hand; every write under a feathered amount, of all four operations, against the
//      engine's arithmetic written out again here; a ramp that has not arrived doing nothing and the same
//      ramp doing its work once it has; the height ramp's inclusive range, read at the moment it runs;
//      both fractal ramp versions
//   2. the worker's messages: the ramps arrive at init, every map of a grid goes out with it in the
//      transfer list, and the colours that come back are the ones the sampler makes on this thread
//   3. what the main thread reads: a colour or a choice of a block not yet made is null and makes no
//      block; the game's terrain takes its ramps from the pack's file; its far grids carry the colours
//      and choices in the game's column order
//   4. every converted world with the client's own ramps (decoded here from the archives, not read from the
//      file the terrain command writes, which groundTextures.test.ts holds to the same TGAs): a pole no colour affector reached is white and every other carries the last
//      colour written there, every write the engine's arithmetic (the worlds' own adds and subtracts under
//      feathered amounts among them); a "multiply" of a real ramp value on white gives (v + 255) / 2,
//      truncated; the fractal ramps' colours are the ramps' own pixels, decoded here from the archives;
//      the mean luminance of Tatooine, Naboo and Corellia holds where the research found it; and the
//      alternates each family's poles pick come out in proportion to the family's own weights
//
// Run: node tools/swg/tests/colorMap.test.ts
import assert from 'node:assert/strict';
import { form, chunk, W, encode, ihdr, mfrc } from './iffWriter.ts';
import { MultiFractal } from '../../../src/swg/terrain/fractal.ts';
import { AffectorColorRampFractal, childChoiceAt, childIndexOf, colourAffectorInfo } from '../../../src/swg/terrain/generator.ts';
import { attachRamp, colorRampFile, parseTerrainTemplate, rampNames, readColorRampFile, TerrainSampler, type ColorRamp } from '../../../src/swg/terrain/trn.ts';
import { TerrainWorkerCore } from '../../../src/swg/terrain/workerCore.ts';
import { COLOR_RAMP_FILE, SwgTerrain } from '../../../src/world/swgTerrain.ts';
import { decodeTga } from '../tga.mjs';
import { mountRetail } from './materialsHarness.ts';
import { groundWorlds, loadWorld, luminance, PACKS, sampleBlocks } from './terrainHarness.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const note = (s: string) => console.log(`note ${s}`);
const rgbOf = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** The engine's combination (computeColor), written out again from its description: the check the generator's own must pass. */
function mirror(old: number, desired: number, op: number, amountIn: number): number {
  const f = Math.fround;
  const a = f(amountIn);
  const o = rgbOf(old);
  const d = rgbOf(desired);
  const out = [0, 1, 2].map((c) => {
    const scaled = a < 1 ? Math.trunc(f(d[c] * a)) : d[c];
    if (op === 1) return Math.min(o[c] + scaled, 255);
    if (op === 2) return Math.max(o[c] - scaled, 0);
    if (op === 3) return Math.trunc(f(f(a * f(f(0.5 * d[c]) + f(0.5 * o[c]))) + f(f(1 - a) * o[c])));
    return Math.trunc(f(f(a * d[c]) + f(f(1 - a) * o[c])));
  });
  return (out[0] << 16) | (out[1] << 8) | out[2];
}

// ---------------------------------------------------------------- 1. a terrain built in memory

const header = new W().str('colour').f32(2048).f32(8).i32(2).i32(0).f32(0).f32(2).str('').f32(60)
  .f32(0).f32(0).f32(16).f32(2).u32(0).f32(0).f32(0).f32(0).f32(0).u32(0).f32(0).f32(0).f32(0).f32(0).u32(0).f32(0).f32(0).f32(0).f32(0).u32(0).u8(1).bytes();
const adta = () => chunk('ADTA', new W().i32(0).i32(0).i32(1).str('').bytes());
const rect = (x0: number, z0: number, x1: number, z1: number) => form('BREC', form('0004', ihdr('rect'), chunk('DATA', new W().f32(x0).f32(z0).f32(x1).f32(z1).i32(0).f32(0).i32(0).i32(0).f32(0).f32(2).str('').i32(0).bytes())));
const circle = (x: number, z: number, r: number, feather: number) => form('BCIR', form('0002', ihdr('circle'), chunk('DATA', new W().f32(x).f32(z).f32(r).i32(0).f32(feather).bytes())));
const accn = (op: number, r: number, g: number, b: number) => form('ACCN', form('0000', ihdr(`colour ${op}`), chunk('DATA', new W().i32(op).u8(r).u8(g).u8(b).bytes())));
const ahcn = (h: number) => form('AHCN', form('0000', ihdr('flat'), chunk('DATA', new W().i32(0).f32(h).bytes())));
const acrh = (op: number, low: number, high: number, ramp: string) => form('ACRH', form('0000', ihdr('by height'), chunk('DATA', new W().i32(op).f32(low).f32(high).str(ramp).bytes())));
const acrf1 = (family: number, op: number, ramp: string) => form('ACRF', form('0001', ihdr('by fractal'), form('DATA', chunk('PARM', new W().i32(family).i32(op).str(ramp).bytes()))));
const acrf0 = (op: number, ramp: string) => form('ACRF', form('0000', ihdr('by its own fractal'), form('DATA', mfrc(4242, { oct: 2, freq: 3, sx: 0.05, sy: 0.05 }), chunk('PARM', new W().i32(op).str(ramp).bytes()))));
const layer = (name: string, ...items: ReturnType<typeof form>[]) => form('LAYR', form('0003', ihdr(name), adta(), ...items));
const RAMP = 'colorramp\\Test_Ramp.TGA';
const testRamp: ColorRamp = { width: 4, rgb: Uint8Array.from([10, 20, 30, 40, 50, 60, 70, 80, 90, 250, 240, 230]) };
const mgrp = form('MGRP', form('0000', form('MFAM', chunk('DATA', new W().i32(1).str('dirt').bytes()), mfrc(1337, { oct: 3, freq: 2, amp: 0.5, sx: 0.02, sy: 0.02 }))));
// One shader family of three alternates, painted under the constants, so a pole's choice has something to say.
const sgrp = form('SGRP', form('0006', chunk('SFAM', new W().i32(1).str('dirt').str('').u8(1).u8(2).u8(3).f32(4).f32(1).i32(3).str('shader/dirt_a.sht').f32(1).str('shader/dirt_b.sht').f32(1).str('shader/dirt_c.sht').f32(1).bytes())));
const ascn = (family: number) => form('ASCN', form('0001', ihdr(`paint ${family}`), chunk('DATA', new W().i32(family).i32(0).f32(1).bytes())));
const tgen = form('TGEN', form('0000', sgrp, form('FGRP', form('0008')), form('RGRP', form('0003')), form('EGRP', form('0002')), mgrp, form('LYRS',
  layer('dirt', rect(0, 0, 70, 10), ascn(1)),
  layer('replace', rect(0, 0, 10, 10), accn(0, 200, 100, 50)),
  layer('multiply', rect(20, 0, 30, 10), accn(3, 100, 0, 255)),
  layer('add', rect(40, 0, 50, 10), accn(0, 100, 100, 100), accn(1, 200, 10, 0)),
  layer('subtract', rect(60, 0, 70, 10), accn(2, 55, 255, 0)),
  layer('feathered', circle(110, 30, 14, 1), accn(0, 0, 64, 255), accn(3, 255, 0, 0)),
  // Add and subtract under a feathered amount: the colour asked for is scaled by the amount before it is added or taken away.
  layer('feathered add', circle(90, 50, 9, 1), accn(0, 100, 100, 100), accn(1, 200, 50, 0)),
  layer('feathered subtract', circle(116, 56, 8, 1), accn(0, 100, 100, 100), accn(2, 55, 255, 10)),
  layer('fractal', rect(0, 40, 20, 60), acrf1(1, 0, RAMP)),
  layer('own fractal', rect(40, 40, 60, 60), acrf0(0, RAMP)),
  layer('height at top', rect(0, 80, 20, 100), ahcn(10), acrh(0, 0, 10, RAMP)),
  layer('height out of range then raised', rect(40, 80, 60, 100), ahcn(10), acrh(0, 11, 20, RAMP), ahcn(15)),
  layer('height inside', rect(80, 80, 100, 100), ahcn(15), acrh(0, 11, 20, RAMP)),
)));
const trnBytes = encode(form('PTAT', form('0015', chunk('DATA', header), tgen, form('BAKE'))));

{
  const t = parseTerrainTemplate(trnBytes);
  const s = new TerrainSampler(t);
  const n = s.numberOfPoles;
  const st = s.blockStart(0, 0);
  // One grid over everything the layers paint: poles 2 m apart from (-4, -4) to (134, 134).
  const wide = 70;
  const pole = (g: { colors: Uint8Array }, x: number, z: number) => {
    const k = (((z + 4) / 2) * wide + (x + 4) / 2) * 3;
    return (g.colors[k] << 16) | (g.colors[k + 1] << 8) | g.colors[k + 2];
  };
  ok(JSON.stringify(rampNames(t)) === JSON.stringify(['colorramp/test_ramp.tga']), 'the ramps the colour affectors name are listed once, keyed in lower case with forward slashes');
  ok(t.generator.summary().ACCN === 11 && t.generator.summary().ACRF === 2 && t.generator.summary().ACRH === 3, 'the colour affectors load as affectors of their own, not inert items');

  const before = s.generate(-4, -4, wide, 2);
  ok(pole(before, 4, 4) === 0xc86432, `replace at full strength lays the colour itself (${hex(pole(before, 4, 4))})`);
  ok(pole(before, 24, 4) === 0xb17fff, `"multiply" on white at full strength is the average: (100 + 255) / 2 = 177, (0 + 255) / 2 truncated = 127, 255 (${hex(pole(before, 24, 4))})`);
  ok(pole(before, 44, 4) === 0xff6e64, `add clamps each channel to a byte: 100 + 200 -> 255, 100 + 10, 100 + 0 (${hex(pole(before, 44, 4))})`);
  ok(pole(before, 64, 4) === 0xc800ff, `subtract clamps at nought: 255 - 55, 255 - 255, 255 - 0 (${hex(pole(before, 64, 4))})`);
  ok(pole(before, 30, 30) === 0xffffff && pole(before, 14, 26) === 0xffffff, 'a pole no colour affector reaches stays white');
  ok(pole(before, 10, 50) === 0xffffff && pole(before, 50, 50) === 0xffffff && pole(before, 10, 90) === 0xffffff, 'a ramp that has not arrived does nothing, as the engine does for an image it cannot load');

  // The feathered circles (in the next block east): every write against the arithmetic written out again above.
  {
    let writes = 0;
    let wrong = 0;
    const partial = [0, 0, 0, 0];
    const grid = s.chunkData(st.x + 64, st.z, n, s.poleStep);
    grid.colorTrace = (by, _i, desired, amount, old, after) => {
      writes++;
      const op = colourAffectorInfo(by)!.operation;
      if (amount < 1) partial[op]++;
      if (mirror(old, desired, op, amount) !== after) wrong++;
    };
    t.generator.generateChunk(grid);
    ok(writes > 100 && partial.every((c) => c > 10) && wrong === 0, `under a feathered amount every write is the engine's arithmetic, each step in single precision (${wrong} of ${writes} differ; partial replace ${partial[0]}, add ${partial[1]}, subtract ${partial[2]}, multiply ${partial[3]})`);
  }

  // The same by hand, with the file's own add and subtract affectors laid on a grey of 100 at chosen amounts.
  {
    const find = (name: string) => t.generator.layers.find((l) => l.name === name)!.affectors[1];
    const lay = (a: ReturnType<typeof find>, amount: number) => {
      const d = s.chunkData(0, 0, 3, 2);
      d.colorMap.fill(100);
      a.affect(0, 0, 0, 0, amount, d);
      return (d.colorMap[0] << 16) | (d.colorMap[1] << 8) | d.colorMap[2];
    };
    // Add (200, 50, 0) at 0.3: the colour is first scaled to (60, 15, 0), then added: (160, 115, 100), where
    // adding the whole colour would clamp to (255, 150, 100). Subtract (55, 255, 10) at 0.5: scaled to
    // (27, 127, 5), each half truncated, then taken away: (73, 0, 95), not (45, 0, 90).
    ok(lay(find('feathered add'), 0.3) === 0xa07364, `add at 0.3 adds the colour scaled by the amount: (160, 115, 100) (${hex(lay(find('feathered add'), 0.3))})`);
    ok(lay(find('feathered subtract'), 0.5) === 0x49005f, `subtract at 0.5 takes away the colour scaled by the amount and truncated: (73, 0, 95) (${hex(lay(find('feathered subtract'), 0.5))})`);
    ok(lay(find('feathered add'), 1) === 0xff9664 && lay(find('feathered subtract'), 1) === 0x2d005a, 'at full strength they add and take away the whole colour, clamped: (255, 150, 100) and (45, 0, 90)');
  }

  ok(attachRamp(t, RAMP, testRamp) && !attachRamp(t, 'colorramp/empty.tga', { width: 0, rgb: new Uint8Array(0) }), 'a ramp attaches by the name the file gives it, and one with no pixels does not');
  const after = s.generate(-4, -4, wide, 2);
  const fractal = new MultiFractal();
  fractal.setSeed(1337);
  fractal.setNumberOfOctaves(3);
  fractal.setFrequency(2);
  fractal.setAmplitude(0.5);
  fractal.setScale(Math.fround(0.02), Math.fround(0.02));
  let fractalRight = 0;
  let fractalPoles = 0;
  for (let z = 42; z <= 58; z += 2) {
    for (let x = 2; x <= 18; x += 2) {
      fractalPoles++;
      const px = Math.trunc(Math.fround(fractal.value2(x, z) * 3));
      const want = (testRamp.rgb[px * 3] << 16) | (testRamp.rgb[px * 3 + 1] << 8) | testRamp.rgb[px * 3 + 2];
      if (pole(after, x, z) === want) fractalRight++;
    }
  }
  ok(fractalRight === fractalPoles, `once the ramp arrives, a fractal ramp lays the ramp's pixel at the whole-number position of the fractal's value (${fractalRight} of ${fractalPoles})`);
  ok(pole(after, 50, 50) !== 0xffffff && [0x0a141e, 0x28323c, 0x46505a, 0xfaf0e6].includes(pole(after, 50, 50)), `a fractal ramp of the old kind brings its own fractal and paints from it too (${hex(pole(after, 50, 50))})`);
  ok(pole(after, 10, 90) === 0xfaf0e6, `the height ramp's range is inclusive: at the top of it the last pixel (${hex(pole(after, 10, 90))})`);
  ok(pole(after, 50, 90) === 0xffffff && after.heights[((90 + 4) / 2) * wide + (50 + 4) / 2] === 15, 'it reads the height as it stands when it runs: out of range then, raised into range after, and left white');
  ok(pole(after, 90, 90) === 0x28323c, `inside the range at 15 of 11..20: (15 - 11) / 9 of three pixels is pixel 1 (${hex(pole(after, 90, 90))})`);
  ok(pole(after, 4, 4) === pole(before, 4, 4) && pole(after, 24, 4) === pole(before, 24, 4), 'the constants are what they were');
  ok(after.heights.every((h, k) => h === before.heights[k]), 'colour moves no height');

  // The pack's file of ramps: written and read back by the same pair.
  const round = readColorRampFile(JSON.parse(JSON.stringify(colorRampFile(new Map([[RAMP, testRamp]])))));
  const back = round.get('colorramp/test_ramp.tga');
  ok(!!back && back.width === 4 && back.rgb.every((v, k) => v === testRamp.rgb[k]), 'the pack\'s colour ramp file reads back exactly what was written, keyed');
  ok(readColorRampFile({ ramps: { 'a.tga': { width: 3, rgb: [1, 2, 3] }, 'b.tga': { width: 'x' } } }).size === 0 && readColorRampFile(null).size === 0, 'a ramp short of its pixels, or a file that is not one, gives nothing');
}

// ---------------------------------------------------------------- 2. the worker's messages

{
  const core = new TerrainWorkerCore();
  const early = core.handle({ type: 'generate', id: 1, startX: 0, startZ: 0, n: 4, step: 2 });
  ok(early.message.type === 'error' && early.transfer.length === 0, 'a grid asked for before init is an error, with nothing to transfer');
  const rgb = testRamp.rgb.slice().buffer;
  const ready = core.handle({ type: 'init', trn: trnBytes.slice().buffer, layers: [], bitmaps: [], ramps: [{ name: RAMP, width: 4, rgb }] });
  ok(ready.message.type === 'ready' && (ready.message.info as { ramps: number }).ramps === 1, 'the ramps arrive at init and the worker says how many it took');
  const s = new TerrainSampler(parseTerrainTemplate(trnBytes));
  attachRamp(s.template, RAMP, testRamp);
  const st = s.blockStart(0, 0);
  const n = s.numberOfPoles;
  const reply = core.handle({ type: 'generate', id: 7, startX: st.x, startZ: st.z, n, step: s.poleStep });
  const m = reply.message as Record<string, unknown> & { id: number };
  const keys = ['heights', 'shaders', 'children', 'colors', 'excluded', 'floraCollidable', 'floraNonCollidable', 'environments', 'seasonal'];
  ok(m.type === 'grid' && m.id === 7 && keys.every((k) => ArrayBuffer.isView(m[k])), 'a grid comes back with its id and every map');
  const lengths = Object.fromEntries(keys.map((k) => [k, (m[k] as ArrayLike<number>).length]));
  ok(lengths.children === n * n && lengths.colors === n * n * 3 && lengths.heights === n * n, `the child choices are a byte a pole and the colours three (${JSON.stringify(lengths)})`);
  const buffers = keys.map((k) => (m[k] as ArrayBufferView).buffer);
  ok(reply.transfer.length === keys.length && buffers.every((b) => reply.transfer.includes(b)) && new Set(reply.transfer).size === keys.length, 'every map is in the transfer list once, so nothing is copied');
  const direct = s.generate(st.x, st.z, n, s.poleStep);
  ok((m.colors as Uint8Array).every((v, k) => v === direct.colors[k]) && (m.children as Uint8Array).every((v, k) => v === direct.children[k]), 'and the colours and choices are the ones the sampler makes on this thread, ramp and all');
}

// ---------------------------------------------------------------- 3. what the main thread reads
//
// The colours and choices are read on the main thread from cached blocks only: a block generated there
// costs one to four milliseconds, so a read of one not yet made answers null and makes nothing. And the
// game's own terrain (centre 100, -50, so game x runs the other way from the file's) reads the pack's file
// of ramps, and its far grids carry the colours and choices in the game's column order.

{
  const s = new TerrainSampler(parseTerrainTemplate(trnBytes));
  attachRamp(s.template, RAMP, testRamp);
  ok(s.colorAt(4, 4) === null && s.childAt(4, 4) === null && !s.hasBlock(0, 0), 'a colour or a choice read before its block is made is null, and the read makes no block');
  s.heightAt(4, 4);
  ok(s.hasBlock(0, 0) && s.colorAt(4, 4) === 0xc86432 && s.childAt(4, 4) === childChoiceAt(4, 4) && s.childAt(4, 30) === 0, `once the block is made they are what it holds: the replace's colour (${hex(s.colorAt(4, 4) ?? 0)}), the painted pole's own choice, nought where nothing painted`);

  const rampJson = new TextEncoder().encode(JSON.stringify(colorRampFile(new Map([[RAMP, testRamp]])))).buffer;
  const asked: string[] = [];
  const terrain = await SwgTerrain.create(trnBytes.slice().buffer, [], 100, -50, async (file) => {
    asked.push(file);
    return file === COLOR_RAMP_FILE ? rampJson : null;
  });
  ok(asked.includes(COLOR_RAMP_FILE) && terrain.ramps.loaded === 1 && terrain.ramps.named.length === 1, `the game's terrain asks the pack for its colour ramps (${COLOR_RAMP_FILE}) and takes the one the terrain names`);
  // The file's pole (4, 4) is game (96, 54).
  ok(terrain.colorIfCached(96, 54) === null && terrain.childIfCached(96, 54) === null && !terrain.sampler.hasBlock(0, 0), 'the game\'s reads of a block not yet made are null and make nothing');
  ok(terrain.prepareArea(64, 0, 64, true) && terrain.sampler.hasBlock(0, 0), 'a game chunk made ready makes the block under it');
  ok(terrain.colorIfCached(96, 54) === 0xc86432 && terrain.childIfCached(96, 54) === childChoiceAt(4, 4), `then they read the block: the colour at game (96, 54) is the file's pole (4, 4) (${hex(terrain.colorIfCached(96, 54) ?? 0)}), its choice that pole's own`);
  // A far tile: column i is game x = 88 + (i - 1) * 8, row j game z = 46 + (j - 1) * 8, so (2, 2) is game
  // (96, 54) again, the file's (4, 4), and (3, 2) is game (104, 54), the file's (-4, 4), which nothing paints.
  const far = terrain.farGrid(88, 46, 64, 8, true)!;
  const fn = 8 + 3;
  const colourOf = (k: number) => (far.colors[k * 3] << 16) | (far.colors[k * 3 + 1] << 8) | far.colors[k * 3 + 2];
  ok(far.children.length === fn * fn && far.colors.length === fn * fn * 3, 'a far grid carries a choice and three colour bytes a sample');
  ok(colourOf(2 * fn + 2) === 0xc86432 && far.children[2 * fn + 2] === childChoiceAt(4, 4), `in the game's column order: its sample at game (96, 54) carries the file's pole (4, 4)'s colour and choice (${hex(colourOf(2 * fn + 2))})`);
  ok(colourOf(2 * fn + 3) === 0xffffff && far.children[2 * fn + 3] === 0, `and its sample at game (104, 54), the file's (-4, 4), is white with no choice (${hex(colourOf(2 * fn + 3))})`);
}

// ---------------------------------------------------------------- 4. the converted worlds, with the client's ramps

const vfs = await mountRetail();
const worlds = groundWorlds();
if (!vfs) note('no SWG folder (SWG in the environment or .env): the colour map of the real worlds is not checked here');
else if (!worlds.length) note(`no converted world under ${PACKS}: the colour map of the real worlds is not checked here`);
else {
  const LUMINANCE: Record<string, number> = { tatooine: 0.56, naboo: 0.62, corellia: 0.57 };
  for (const w of Object.keys(LUMINANCE)) if (!worlds.includes(w)) note(`${w} is not converted under ${PACKS}: the floor on its colour map's mean luminance is not checked`);
  // The worlds whose own colour affectors add and take away under a feathered amount (Tatooine, Naboo,
  // Corellia, Mustafar and Yavin 4 have none in their sampled blocks; these have thousands).
  const PARTIAL_ADDS = ['dantooine', 'rori', 'endor', 'lok', 'dathomir', 'kashyyyk_main', 'kashyyyk_dead_forest'];
  let multiplyOnWhite = 0;
  let multiplyWrong = 0;
  let untouchedAll = 0;
  let partialAddSub = 0;
  const tgaCache = new Map<string, { width: number; rgba: Uint8Array }>();
  /** A ramp's pixel at `t` of its width as the archives hold it, decoded here (black off either end, as the engine reads it). */
  const archivePixel = (ramp: string, t: number) => {
    let img = tgaCache.get(ramp);
    if (!img) tgaCache.set(ramp, (img = decodeTga(vfs.read(ramp)) as { width: number; rgba: Uint8Array }));
    const px = Math.trunc(Math.fround(t * (img.width - 1)));
    return px >= 0 && px < img.width ? (img.rgba[px * 4] << 16) | (img.rgba[px * 4 + 1] << 8) | img.rgba[px * 4 + 2] : 0;
  };
  // Every converted world: Mustafar and Yavin 4 keep ground no colour affector reaches, Tatooine, Naboo and
  // Corellia are tinted all over, and Dantooine, Rori and the rest add and take away under feathered amounts.
  for (const name of worlds) {
    const world = loadWorld(name, vfs)!;
    const s = world.sampler;
    const gen = world.template.generator;
    ok(world.ramps.missing.length === 0, `${name}: every one of the ${world.ramps.named.length} ramps its colour affectors name is in the archives (${world.ramps.missing.join(', ') || 'none missing'})${world.ramps.tall.length ? `; more than one row: ${world.ramps.tall.join(', ')}` : ''}`);
    const blocks = sampleBlocks(world.template, 64);
    const n = s.numberOfPoles;
    let touchedWrong = 0;
    let whiteWrong = 0;
    let untouched = 0;
    let writes = 0;
    let writesWrong = 0;
    let rampChecked = 0;
    let rampWrong = 0;
    let lumSum = 0;
    let lumN = 0;
    const counts = new Map<number, Map<number, number>>();
    for (const b of blocks) {
      const st = s.blockStart(b.bx, b.bz);
      const last = new Int32Array(n * n).fill(-1);
      const d = s.chunkData(st.x, st.z, n, s.poleStep);
      d.colorTrace = (by, i, desired, amount, old, after) => {
        last[i] = after;
        writes++;
        const op = colourAffectorInfo(by)!.operation;
        if (amount < 1 && (op === 1 || op === 2)) partialAddSub++;
        if (mirror(old, desired, op, amount) !== after) writesWrong++;
        if (by instanceof AffectorColorRampFractal && rampChecked < 4000) {
          // The ramp's own pixel, from the archives' TGA decoded here, at the fractal's value at the pole's place.
          const wx = st.x + (i % n) * s.poleStep;
          const wz = st.z + Math.floor(i / n) * s.poleStep;
          rampChecked++;
          if (desired !== archivePixel(by.ramp, gen.fractalGroup.get(by.familyId)!.value2(wx, wz))) rampWrong++;
        }
      };
      gen.generateChunk(d);
      for (let k = 0; k < n * n; k++) {
        const c = (d.colorMap[k * 3] << 16) | (d.colorMap[k * 3 + 1] << 8) | d.colorMap[k * 3 + 2];
        if (last[k] < 0) {
          untouched++;
          if (c !== 0xffffff) whiteWrong++;
        } else if (c !== last[k]) touchedWrong++;
      }
      // The block's own poles, its pads left to its neighbours.
      for (let z = 2; z <= n - 3; z++) {
        for (let x = 2; x <= n - 3; x++) {
          const k = z * n + x;
          lumSum += luminance(d.colorMap[k * 3], d.colorMap[k * 3 + 1], d.colorMap[k * 3 + 2]);
          lumN++;
          const fam = d.shaderMap[k];
          const family = gen.shaderGroup.families.get(fam);
          if (!family || family.children.filter((c) => c.weight > 0).length < 2) continue;
          let m = counts.get(fam);
          if (!m) counts.set(fam, (m = new Map()));
          const child = childIndexOf(family, d.shaderChild[k]);
          m.set(child, (m.get(child) ?? 0) + 1);
        }
      }
    }
    untouchedAll += untouched;
    ok(whiteWrong === 0 && touchedWrong === 0, `${name}: over ${blocks.length} blocks every pole no colour affector reached is white (${untouched} of them) and every other carries the last colour written there (${touchedWrong + whiteWrong} do not)`);
    ok(writesWrong === 0, `${name}: every one of the ${writes} colours written is the engine's combination of what was there with what was asked (${writesWrong} differ)`);
    if (rampChecked) ok(rampWrong === 0, `${name}: the fractal ramps lay their ramps' own pixels, decoded here from the archives (${rampWrong} of ${rampChecked} differ)`);

    // Each of the world's own "multiply" fractal ramps laid at full strength on a white map, at a few
    // dozen places: the ramp's real value v must come out as (v + 255) / 2, truncated.
    const multiplies: AffectorColorRampFractal[] = [];
    const walk = (layers: typeof gen.layers) => {
      for (const l of layers) {
        for (const a of l.affectors) if (a instanceof AffectorColorRampFractal && a.operation === 3 && a.active) multiplies.push(a);
        walk(l.layers);
      }
    };
    walk(gen.layers);
    for (const a of multiplies.slice(0, 6)) {
      const st = s.blockStart(blocks[0].bx, blocks[0].bz);
      const d = s.chunkData(st.x, st.z, n, s.poleStep);
      for (let z = 2; z < n - 2; z += 5) {
        for (let x = 2; x < n - 2; x += 5) {
          const wx = st.x + x * s.poleStep;
          const wz = st.z + z * s.poleStep;
          a.affect(wx, wz, x, z, 1, d);
          const v = rgbOf(archivePixel(a.ramp, gen.fractalGroup.get(a.familyId)!.value2(wx, wz)));
          const k = (z * n + x) * 3;
          multiplyOnWhite++;
          if (d.colorMap[k] !== Math.trunc((v[0] + 255) / 2) || d.colorMap[k + 1] !== Math.trunc((v[1] + 255) / 2) || d.colorMap[k + 2] !== Math.trunc((v[2] + 255) / 2)) multiplyWrong++;
        }
      }
    }
    const mean = lumSum / lumN;
    if (LUMINANCE[name] !== undefined) ok(Math.abs(mean - LUMINANCE[name]) <= 0.02, `${name}: the colour map's mean luminance is ${mean.toFixed(3)}, within 0.02 of the ${LUMINANCE[name]} the research found`);
    else note(`${name}: the colour map's mean luminance is ${mean.toFixed(3)}`);
    let worst = 0;
    let worstAt = '';
    let families = 0;
    for (const [fam, m] of counts) {
      const total = [...m.values()].reduce((a, v) => a + v, 0);
      if (total < 10000) continue;
      families++;
      const family = gen.shaderGroup.families.get(fam)!;
      const sum = family.children.reduce((a, c) => a + c.weight, 0);
      family.children.forEach((c, i) => {
        const off = Math.abs((m.get(i) ?? 0) / total - c.weight / sum);
        if (off > worst) {
          worst = off;
          worstAt = `${family.name} child ${i}`;
        }
      });
    }
    if (families) ok(worst <= 0.02, `${name}: over the ${families} families with alternates and at least 10,000 poles each, every child is picked in proportion to its weight within 2% (worst ${(worst * 100).toFixed(2)}%, ${worstAt})`);
    else note(`${name}: no family with alternates covers 10,000 sampled poles`);
  }
  ok(multiplyOnWhite > 0 && multiplyWrong === 0, `a "multiply" of a real ramp value on white at full strength is (v + 255) / 2, truncated (${multiplyWrong} of ${multiplyOnWhite} differ)`);
  ok(untouchedAll > 0, `some real ground is reached by no colour affector and is white (${untouchedAll} poles)`);
  if (PARTIAL_ADDS.some((w) => worlds.includes(w))) ok(partialAddSub > 1000, `the worlds' own adds and subtracts under a feathered amount were among the writes checked (${partialAddSub})`);
  else note(`none of ${PARTIAL_ADDS.join(', ')} is converted: no real add or subtract under a feathered amount was checked`);
}

console.log(`\n${passed} checks passed`);
