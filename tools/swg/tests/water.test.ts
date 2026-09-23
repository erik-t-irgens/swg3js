// The water exporter on synthetic shaders: colours and opacity from a MAIN texture's mean taken in
// linear light, ripple from a normal map's slope, drift from the TSNS scroll rate, a cube map
// written as six mirrored PNGs, and lava told from water by effect, by water type and by name.
// Also the two client tables that say what being in water costs you and who pays nothing, the join
// from a row's server template to the shared one every pack is keyed on, and the `status` rule that
// asks for the command again. Every table below is made up here; none of it is read from anyone's
// archives. And the game's own reader of what all this writes (src/world/waterLook.ts) and the
// occlusion-query state machine that decides whether any water is on screen (waterVisibility.ts).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { form, chunk, W, encode } from './iffWriter.ts';
import { cubeFaces } from '../sky.mjs';
import { findAll, parseIff } from '../iff.mjs';
import { shaderTextures } from '../sht.mjs';
import { decodeDdsVolume } from '../dds.mjs';
import { parseDatatable } from '../datatable.mjs';
import { CREATURE_WATER_VALUES, exportWater, isLavaEffect, lavaEntry, lavaParams, linearToSrgbHex, meanLinear, normalSlope, readWaterHarm, REFERENCE_SCROLL, REFERENCE_SLOPE, textureFactorOf, WATER_CUBE_SIZE, WATER_VALUES, waterHarmLines, waterHarmTypes, waterImmunity, waterPackNeedsHarm } from '../water.mjs';
import { envLightFrom, isLavaWater, readWaterPack, shaderKey, waterLookFor, type WaterShaderInfo } from '../../../src/world/waterLook.ts';
import { drawsBefore, sortByDraw, WaterVisibility, type WaterDrawKey } from '../../../src/world/waterVisibility.ts';

let passed = 0;
const ok = (cond: boolean, msg: string) => { assert.ok(cond, msg); passed++; console.log(`ok   ${msg}`); };
const round3 = (v: number) => Math.round(v * 1000) / 1000;

// --- fixtures -------------------------------------------------------------------------------

/** An uncompressed 32-bit DDS (BGRA on disk), a cube map when six faces are given. */
function dds(width: number, height: number, faces: Uint8Array[]): Buffer {
  const w = new W();
  w.str('DDS').parts.pop(); // "DDS " magic: drop the NUL, add the space
  w.u8(0x20);
  w.u32(124).u32(0x1 | 0x2 | 0x4 | 0x1000).u32(height).u32(width).u32(width * 4).u32(0).u32(1);
  for (let i = 0; i < 11; i++) w.u32(0);
  w.u32(32).u32(0x41).u32(0).u32(32).u32(0x00ff0000).u32(0x0000ff00).u32(0x000000ff).u32(0xff000000);
  w.u32(0x1000 | (faces.length > 1 ? 0x8 : 0)).u32(faces.length > 1 ? 0x200 | 0xfc00 : 0).u32(0).u32(0).u32(0);
  const header = Buffer.from(w.bytes());
  const body = Buffer.alloc(faces.reduce((n, f) => n + f.length, 0));
  let o = 0;
  for (const f of faces) for (let i = 0; i < f.length; i += 4) { body[o++] = f[i + 2]; body[o++] = f[i + 1]; body[o++] = f[i]; body[o++] = f[i + 3]; }
  return Buffer.concat([header, body]);
}
function solid(width: number, height: number, rgba: number[]): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) out.set(rgba, i * 4);
  return out;
}
/** A face whose left half is one colour and right half another, so mirroring shows. */
function halves(size: number, left: number[], right: number[]): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) out.set(x < size / 2 ? left : right, (y * size + x) * 4);
  return out;
}
/** Rows 0-1 flat, rows 2-3 tilted along x: a normal map with a mean slope that can be worked out by hand. */
function normalMap(): Uint8Array {
  const out = new Uint8Array(4 * 4 * 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) out.set(y < 2 ? [128, 128, 255, 255] : [137, 128, 255, 255], (y * 4 + x) * 4);
  return out;
}

const files = new Map<string, Buffer>();
const put = (p: string, b: Uint8Array | Buffer) => files.set(p.toLowerCase(), Buffer.from(b));
const vfs = { has: (p: string) => files.has(p.toLowerCase()), read: (p: string) => files.get(p.toLowerCase())!, list: () => [] as string[] };

/** A texture slot: the tag is written little-endian on disk, so "MAIN" is stored as "NIAM". */
const slotData = (slot: string) => {
  const w = new W();
  for (const ch of [...slot].reverse()) w.u8(ch.charCodeAt(0));
  for (let i = 0; i < 8; i++) w.u8(0);
  return w.bytes();
};
type Item = ReturnType<typeof form>;
const txm = (slot: string, path: string): Item => form('TXM ', form('0002', chunk('DATA', slotData(slot)), chunk('NAME', new W().str(path).bytes())));
/** FORM TSNS holding one 20-byte chunk: a tag, then four floats, the first being the scroll rate. */
const tsns = (rate: number): Item => form('TSNS', chunk('0000', new W().u8(0x54).u8(0x53).u8(0x4e).u8(0x53).f32(rate).f32(0).f32(0).f32(0).bytes()));
const sht = (effect: string, txms: Item[], extra: Item[] = []) => encode(form('SSHT', form('0001', chunk('NAME', new W().str(effect).bytes()), form('TXMS', ...txms), ...extra)));

put('texture/wter_main.dds', dds(4, 4, [solid(4, 4, [106, 137, 131, 129])]));
put('texture/wter_fallback.dds', dds(4, 4, [solid(4, 4, [73, 123, 115, 255])]));
put('texture/wter_test_n.dds', dds(4, 4, [normalMap()]));
put('texture/wter_calm_n.dds', dds(4, 4, [solid(4, 4, [128, 128, 255, 255])]));
{
  // A 256 px cube so the writer has to halve it: -X is red on the left, blue on the right.
  const grey = solid(256, 256, [128, 128, 128, 255]);
  put('texture/env_test.dds', dds(256, 256, [solid(256, 256, [255, 0, 0, 255]), halves(256, [200, 0, 0, 255], [0, 0, 200, 255]), solid(256, 256, [0, 255, 0, 255]), grey, grey, grey]));
}
put('shader/wter_test.sht', sht('effect\\water.eft', [txm('MAIN', 'texture\\wter_main.dds'), txm('MFFP', 'texture\\wter_fallback.dds'), txm('NRML', 'texture\\wter_test_n.dds'), txm('CUBE', 'texture\\env_test.dds'), txm('ENVM', '')], [tsns(-0.0616)]));
put('shader/wter_share.sht', sht('effect\\water.eft', [txm('MAIN', 'texture\\wter_main.dds'), txm('CUBE', 'texture\\env_test.dds')]));
put('shader/wter_calm.sht', sht('effect\\water.eft', [txm('MAIN', 'texture\\wter_main.dds'), txm('NRML', 'texture\\wter_calm_n.dds')]));
put('shader/wter_nocube.sht', sht('effect\\water.eft', [txm('MAIN', 'texture\\wter_main.dds'), txm('CUBE', 'texture\\texture\\env_missing.dds')]));
/** An 8-bit luminance volume DDS (DDSCAPS2_VOLUME), or with other flags to see it refused. */
function ddsVolume(width: number, height: number, depth: number, data: Uint8Array, opts: { pfFlags?: number; bitCount?: number; caps2?: number } = {}): Buffer {
  const w = new W();
  w.str('DDS').parts.pop();
  w.u8(0x20);
  w.u32(124).u32(0x1 | 0x2 | 0x4 | 0x1000 | 0x800000).u32(height).u32(width).u32(width).u32(depth).u32(1);
  for (let i = 0; i < 11; i++) w.u32(0);
  w.u32(32).u32(opts.pfFlags ?? 0x20000).u32(0).u32(opts.bitCount ?? 8).u32(0xff).u32(0).u32(0).u32(0);
  w.u32(0x1000 | 0x8).u32(opts.caps2 ?? 0x200000).u32(0).u32(0).u32(0);
  return Buffer.concat([Buffer.from(w.bytes()), Buffer.from(data)]);
}
/** A lava shader's MATS form: the MATL's four ARGB groups and a power, the third group loopTime and the flow, the fourth a, colorScale, colorBias, tcScale. */
const mats = (): Item => {
  const matl = new W();
  for (const v of [1, 1, 1, 1, 1, 1, 1, 1, 100, 0, 0.03, 0.02, 1, 1.1, -0.23, 1.55, 0]) matl.f32(v);
  return form('MATS', form('0000', chunk('TAG ', new Uint8Array([0x4e, 0x49, 0x41, 0x4d])), chunk('MATL', matl.bytes())));
};
/** FORM TFNS: one 8-byte entry, the tag BLUM stored reversed, then the ARGB value 0xff484848. */
const tfns = (): Item => form('TFNS', chunk('0000', new Uint8Array([0x4d, 0x55, 0x4c, 0x42, 0x48, 0x48, 0x48, 0xff])));
const findMatl = (p: string): Buffer => findAll(parseIff(vfs.read(p)), 'MATL')[0].data;
const rampRgba = new Uint8Array([10, 0, 0, 20, 80, 10, 0, 100, 200, 60, 0, 180, 255, 140, 20, 250]);
put('texture/lava_ramp_test.dds', dds(4, 1, [rampRgba]));
put('texture/lava_mix_test.dds', dds(2, 2, [new Uint8Array([90, 36, 22, 0, 60, 20, 10, 0, 120, 50, 30, 128, 30, 10, 5, 0])]));
put('texture/lava_noise_test.dds', ddsVolume(4, 4, 4, Uint8Array.from({ length: 64 }, (_, i) => i)));
put('shader/wter_lava_test.sht', sht('effect/water_lava_textured.eft', [txm('MAIN', 'texture\\wter_main.dds'), txm('CUBE', 'texture\\env_test.dds'), txm('LKUP', 'texture\\lava_ramp_test.dds'), txm('TEXT', 'texture\\lava_mix_test.dds'), txm('NOIS', 'texture\\lava_noise_test.dds')], [mats(), tfns()]));
put('shader/wter_lava_test2.sht', sht('effect/water_lava_textured.eft', [txm('LKUP', 'texture\\lava_ramp_test.dds'), txm('TEXT', 'texture\\absent.dds'), txm('NOIS', 'texture\\lava_noise_test.dds')], [mats()]));
put('shader/wter_test_as_lava.sht', sht('effect\\water.eft', [txm('MAIN', 'texture\\wter_main.dds'), txm('NRML', 'texture\\wter_test_n.dds')]));

/** A datatable (DTII > 0001 > COLS, TYPE, ROWS) as the client writes one, for the converter's own parser. */
const dt = (columns: string[], types: string[], rows: (string | number)[][]): Item => {
  const c = new W().i32(columns.length);
  for (const x of columns) c.str(x);
  const t = new W();
  for (const x of types) t.str(x);
  const r = new W().i32(rows.length);
  for (const row of rows) row.forEach((v, i) => (types[i][0] === 's' ? r.str(String(v)) : types[i][0] === 'f' ? r.f32(Number(v)) : r.i32(Number(v))));
  return form('DTII', form('0001', chunk('COLS', c.bytes()), chunk('TYPE', t.bytes()), chunk('ROWS', r.bytes())));
};
/** Made-up water kinds, so nothing here is the client's own numbers: a third row proves the index is read and not assumed. */
const waterValues = dt(
  ['water_type', 'causes_damage', 'damage_kills', 'damage_interval_secs', 'damage_per_interval_percentage', 'transparent'],
  ['s', 'i', 'i', 'i', 'f', 'i'],
  [['calm', 0, 0, 0, 0, 1], ['molten', 1, 1, 2, 40, 0], ['scalding', 1, 0, 3, 12.5, 1]],
);
/** Made-up templates: two with a shared sibling in the archives, one without, one written the way an exporter leaves paths. */
const creatureValues = dt(
  ['object_template_name', 'lava_resistance'],
  ['s', 'f'],
  [
    ['object/mobile/vehicle/test_float_skiff.iff', 100],
    ['object/mobile/som/test_ember_bug.iff', 50],
    ['object/mobile/vehicle/test_absent_rider.iff', 100],
    ['Object\\Mobile\\Vehicle\\TEST_Caps_Rider.IFF', 100],
  ],
);
put(WATER_VALUES, encode(waterValues));
put(CREATURE_WATER_VALUES, encode(creatureValues));
for (const p of ['object/mobile/vehicle/shared_test_float_skiff.iff', 'object/mobile/som/shared_test_ember_bug.iff', 'object/mobile/vehicle/shared_test_caps_rider.iff']) put(p, new Uint8Array(0));

const uses = [
  { shader: 'wter_test', waterTypes: [0], tables: 2, global: true },
  { shader: 'wter_share', waterTypes: [0], tables: 1, global: false },
  { shader: 'wter_calm', waterTypes: [0], tables: 1, global: false },
  { shader: 'wter_nocube', waterTypes: [0], tables: 1, global: false },
  { shader: 'wter_lava_test', waterTypes: [0], tables: 1, global: false },
  { shader: 'wter_test_as_lava', waterTypes: [1], tables: 1, global: false },
  { shader: 'wter_lava_test2', waterTypes: [1], tables: 1, global: false },
  { shader: 'wter_gone', waterTypes: [0], tables: 1, global: false },
  { shader: 'lava_gone', waterTypes: [0], tables: 1, global: false },
];
const template = { useGlobalWaterTable: true, globalWaterTableHeight: 9, globalWaterTableShaderSize: 3 };

// --- the exporter ----------------------------------------------------------------------------

const out = mkdtempSync(join(tmpdir(), 'water-'));
const logs: string[] = [];
const returned = exportWater(vfs, 'testplanet', uses, template, out, { log: (m: string) => logs.push(m) });
const pack = JSON.parse(readFileSync(join(out, 'water.json'), 'utf8'));
ok(returned === 'water.json' && pack.version === 1 && pack.planet === 'testplanet', 'water.json is written and names its planet');
ok(JSON.stringify(pack.global) === JSON.stringify({ height: 9, shader: 'wter_test', shaderSize: 3 }), `the global table names the shader the terrain gives it (${JSON.stringify(pack.global)})`);

const test = pack.shaders.wter_test;
ok(test.kind === 'water' && test.file === 'shader/wter_test.sht' && test.effect === 'effect/water.eft' && test.tables === 2 && test.global === true, `the entry keeps where it came from (${JSON.stringify({ f: test.file, e: test.effect })})`);
ok(test.color === '#6a8983', `a solid main texture's linear mean encodes back to itself (${test.color})`);
ok(test.alpha === 0.506 && test.opacity === 0.753, `opacity is the client's 0.5 + a/2 (${test.alpha}, ${test.opacity})`);
ok(test.fallbackColor === '#497b73', `the fallback colour comes from MFFP (${test.fallbackColor})`);
{
  // Half the texels flat, half tilted 9.5/127.5 along x; ripple is that mean slope over the reference.
  const f = 0.5 / 127.5;
  const s = 9.5 / 127.5;
  const expected = round3((Math.hypot(f, f) + Math.hypot(s, f)) / 2 / REFERENCE_SLOPE);
  ok(test.ripple === 0.525 && test.ripple === expected, `ripple is the normal map's mean slope over the reference (${test.ripple})`);
  ok(test.normalMap === 'texture/wter_test_n.dds', 'the entry names the normal map it measured');
}
ok(test.drift === 0.5 && test.drift === round3(0.0616 / REFERENCE_SCROLL), `drift is the TSNS scroll rate over the reference (${test.drift})`);

ok(test.cube.size === WATER_CUBE_SIZE && test.cube.source === 256 && test.cube.faces.length === 6 && test.cube.file === 'texture/env_test.dds', `the cube is halved to ${WATER_CUBE_SIZE} and its source size kept (${JSON.stringify({ size: test.cube.size, source: test.cube.source })})`);
ok(test.cube.faces[0] === 'water/env_test_px.png' && test.cube.faces.every((f: string) => existsSync(join(out, f))), 'the six faces are written under water/');

/** Our encoder writes filter-0 rows in one zlib stream, so decoding is inflate and strip. */
const decodePng = (buf: Buffer) => {
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  let o = 8;
  const idat: Buffer[] = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('latin1', o + 4, o + 8);
    if (type === 'IDAT') idat.push(buf.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) rgba.set(raw.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4);
  return { width, height, rgba };
};
{
  // The game's X axis is mirrored, so the written +X face is the archive's -X, flipped: its red
  // left half must come out on the right.
  const px = decodePng(readFileSync(join(out, 'water/env_test_px.png')));
  const at = (x: number) => [px.rgba[x * 4], px.rgba[x * 4 + 2]].join();
  ok(px.width === WATER_CUBE_SIZE && px.height === WATER_CUBE_SIZE, `each face is ${WATER_CUBE_SIZE} square (${px.width}x${px.height})`);
  ok(at(0) === '0,200' && at(WATER_CUBE_SIZE - 1) === '200,0', `the written +X face is the archive's -X, mirrored (left ${at(0)}, right ${at(WATER_CUBE_SIZE - 1)})`);
  ok(px.rgba[3] === 255, 'the faces are written opaque');
}
ok(pack.shaders.wter_share.cube.faces.join() === test.cube.faces.join(), 'two shaders naming one cube share its faces');

const calm = pack.shaders.wter_calm;
ok(calm.ripple === 0.073, `a flat normal map barely ripples, exactly as the archives' calm water shader measures (${calm.ripple})`);
ok(calm.cube === undefined && calm.cubeMissing === undefined, 'a shader with no CUBE slot gets no cube and no complaint');
ok(calm.drift === 1, 'a shader with no TSNS drifts at the reference rate');

ok(pack.shaders.wter_nocube.cubeMissing === 'texture/texture/env_missing.dds' && pack.shaders.wter_nocube.cube === undefined, `a named cube that is not in the archives is recorded as missing (${pack.shaders.wter_nocube.cubeMissing})`);

for (const id of ['wter_lava_test', 'wter_test_as_lava']) {
  const e = pack.shaders[id];
  ok(e.kind === 'lava' && e.color === undefined && e.cube === undefined && e.ripple === undefined, `${id} is lava, with no colour and no cube`);
}
ok(pack.shaders.wter_gone.missing === true && pack.shaders.wter_gone.kind === 'water', 'a shader that is not in the archives is marked missing');
ok(pack.shaders.lava_gone.missing === true && pack.shaders.lava_gone.kind === 'lava', 'a missing shader that names lava still reads as lava');
ok(pack.notes.some((n: string) => n.includes('wter_gone')) && logs.some((l) => l.includes('9 shaders (5 water, 4 lava), 1 cubes, lava files 2 -> water.json')), `the log counts water, lava, cubes and the lava files written (${logs[0]})`);

// --- the lava look (the heat design's part of water.json) ---------------------------------------

{
  const matl = findMatl('shader/wter_lava_test.sht');
  const p = lavaParams(matl)!;
  ok(p.loopTime === 100 && p.flow.join() === '0,0.03,0.02' && Math.abs(p.colorScale - 1.1) < 1e-6 && Math.abs(p.colorBias + 0.23) < 1e-6 && Math.abs(p.tcScale - 1.55) < 1e-6, `the MATL's third and fourth groups are loopTime, the flow, colorScale, colorBias and tcScale (${JSON.stringify(p)})`);
  ok(lavaParams(matl.subarray(0, 60)) === null && lavaParams(undefined) === null, 'a MATL shorter than 64 bytes, or none, gives no lava values');
  const bad = Buffer.from(matl);
  bad.writeFloatLE(Number.NaN, 13 * 4);
  ok(lavaParams(bad) === null, 'a MATL with a value that is not a number gives none');
  ok(Math.abs(textureFactorOf(parseIff(vfs.read('shader/wter_lava_test.sht')))! - 72 / 255) < 1e-6, 'the bloom factor is the red of the TFNS entry tagged BLUM (stored MULB)');
  ok(textureFactorOf(parseIff(vfs.read('shader/wter_lava_test2.sht'))) === null, 'a shader with no TFNS has no bloom factor');
}
{
  const vol = decodeDdsVolume(files.get('texture/lava_noise_test.dds')!);
  ok(vol.width === 4 && vol.height === 4 && vol.depth === 4 && vol.data.length === 64 && vol.data.every((v: number, i: number) => v === i), 'a luminance volume reads as its bytes, x fastest');
  const throws = (buf: Buffer) => { try { decodeDdsVolume(buf); return false; } catch { return true; } };
  ok(throws(ddsVolume(4, 4, 4, new Uint8Array(256), { pfFlags: 0x41, bitCount: 32 })), 'a 32-bit volume is refused');
  ok(throws(files.get('texture/lava_ramp_test.dds')!), 'a flat DDS is not a volume');
  ok(throws(ddsVolume(4, 4, 4, new Uint8Array(63))), 'a volume one byte short is refused');
}
{
  const lava = pack.shaders.wter_lava_test.lava;
  ok(lava.loopTime === 100 && lava.flow.join() === '0,0.03,0.02' && lava.colorScale === 1.1 && lava.colorBias === -0.23 && lava.tcScale === 1.55, `the lava entry carries the MATL's values, rounded clean (${JSON.stringify({ s: lava.colorScale, b: lava.colorBias, t: lava.tcScale })})`);
  ok(lava.textureFactor === 0.2824, `and the bloom factor to four places (${lava.textureFactor})`);
  const ramp = Buffer.from(lava.ramp.rgba, 'base64');
  ok(lava.ramp.width === 4 && ramp.length === 16 && ramp.every((v, i) => v === rampRgba[i]), 'the ramp goes inline, byte for byte, alpha and all');
  ok(lava.mix === 'water/lava_mix_test.png', `the crust is written under water/ (${lava.mix})`);
  const mix = decodePng(readFileSync(join(out, lava.mix)));
  ok(mix.width === 2 && mix.height === 2 && [3, 7, 11, 15].every((i) => mix.rgba[i] === 255) && mix.rgba[0] === 90 && mix.rgba[8] === 120, 'the crust keeps its colours and is written opaque');
  ok(JSON.stringify(lava.noise) === JSON.stringify({ file: 'water/lava_noise_test.r8', size: [4, 4, 4] }), `the noise volume is written with its size (${JSON.stringify(lava.noise)})`);
  const r8 = readFileSync(join(out, lava.noise.file));
  ok(r8.length === 64 && r8.every((v, i) => v === i), 'as its bytes, exactly');
  const two = pack.shaders.wter_lava_test2.lava;
  ok(two.mix === null && two.textureFactor === null && two.noise.file === lava.noise.file, 'a crust not in the archives is null, no TFNS is no factor, and the shared noise is the same file');
  ok(pack.notes.some((n: string) => n.includes('texture/absent.dds')), 'and the missing crust is named in the notes');
  ok(pack.shaders.wter_test_as_lava.kind === 'lava' && pack.shaders.wter_test_as_lava.lava === undefined, 'a type-1 table wearing a water shader is lava with no lava block (the game gives it the stand-in look)');
}
{
  // A lava file is written once per planet: the second shader naming it finds it in `written`.
  const once = mkdtempSync(join(tmpdir(), 'water-once-'));
  const root = parseIff(vfs.read('shader/wter_lava_test.sht'));
  const { slots } = shaderTextures(root);
  const written = new Map();
  const notes: string[] = [];
  const first = lavaEntry(vfs, root, slots, once, written, notes);
  ok(first.noise.file === 'water/lava_noise_test.r8' && existsSync(join(once, first.noise.file)), 'lavaEntry writes the noise the first time');
  rmSync(join(once, first.noise.file));
  const second = lavaEntry(vfs, root, slots, once, written, notes);
  ok(JSON.stringify(second.noise) === JSON.stringify(first.noise) && !existsSync(join(once, first.noise.file)), 'and not again for the same planet');
}

{
  const empty = mkdtempSync(join(tmpdir(), 'water-dry-'));
  exportWater(vfs, 'dry', [], { useGlobalWaterTable: false, globalWaterTableHeight: 0, globalWaterTableShaderSize: 2 }, empty, { log: () => {} });
  const dry = JSON.parse(readFileSync(join(empty, 'water.json'), 'utf8'));
  ok(Object.keys(dry.shaders).length === 0 && dry.global === null, 'a planet with no water still gets a water.json, so status only has to see the file');
  ok(!existsSync(join(empty, 'water')), 'and no empty water folder is made for it');
}
{
  // Lava carries no cube, so a planet whose lava writes no file of its own must be left without a
  // water/ folder as well: the folder is made where the first file is written, not for the planet
  // having shaders at all.
  const molten = mkdtempSync(join(tmpdir(), 'water-lava-'));
  exportWater(vfs, 'lavaplanet', [{ shader: 'wter_test_as_lava', waterTypes: [1], tables: 3, global: false }, { shader: 'lava_gone', waterTypes: [0], tables: 1, global: false }], template, molten, { log: () => {} });
  const all = JSON.parse(readFileSync(join(molten, 'water.json'), 'utf8'));
  ok(all.shaders.wter_test_as_lava.kind === 'lava' && all.shaders.lava_gone.kind === 'lava' && !existsSync(join(molten, 'water')), 'a planet whose shaders are all lava with nothing to write gets its water.json and no empty water folder either');
  // A lava planet whose shaders have their look writes the crust and the noise there, and nothing else.
  const lavaPlanet = mkdtempSync(join(tmpdir(), 'water-lava-look-'));
  exportWater(vfs, 'lavaplanet', [{ shader: 'wter_lava_test', waterTypes: [0], tables: 3, global: false }], template, lavaPlanet, { log: () => {} });
  ok(readdirSync(join(lavaPlanet, 'water')).sort().join() === 'lava_mix_test.png,lava_noise_test.r8', `a lava look's files are its crust and its noise (${readdirSync(join(lavaPlanet, 'water')).join()})`);
}
{
  // Every write goes through the injected writer, so the faces of a shared cube can be counted.
  const counted = mkdtempSync(join(tmpdir(), 'water-count-'));
  const wrote: string[] = [];
  exportWater(vfs, 'testplanet', uses, template, counted, { log: () => {}, writeFile: (p: string) => wrote.push(p) });
  const faces = wrote.filter((p) => p.includes('env_test_'));
  ok(faces.length === 6, `a cube two shaders both name is written once (${faces.length} face writes)`);
  const lavaFiles = wrote.filter((p) => /lava_(mix|noise)_test/.test(p));
  ok(lavaFiles.length === 2, `the crust and the noise two lava shaders share are written once each (${lavaFiles.length} writes)`);
  ok(wrote.filter((p) => p.endsWith('water.json')).length === 1 && wrote.length === 9, `nothing else is written (${wrote.length} files)`);
  ok(readdirSync(join(out, 'water')).length === 8, 'and only those six PNGs, the crust and the noise are on disk');
}

// --- what the client says water does to you (the harm block) -----------------------------------

{
  const types = waterHarmTypes(parseDatatable(parseIff(Buffer.from(encode(waterValues)))));
  ok(types.length === 3 && types.map((t: { type: number }) => t.type).join() === '0,1,2', 'a row keeps its index, which is what the terrain\'s own water type is read as');
  ok(types[0].name === 'calm' && types[1].name === 'molten', 'and its own name beside it, so a reader can check the two agree');
  ok(types[0].damage === false && types[0].kills === false && types[0].transparent === true, 'the flags come back as flags, not as the ones and noughts the table stores');
  ok(types[1].damage === true && types[1].kills === true && types[1].intervalSeconds === 2, 'a kind that hurts says so, says it kills, and says how often it lands');
  ok(types[1].percent === 40 && types[1].share === 0.4, `the percentage is kept as the table has it and again as a fraction (${types[1].percent}, ${types[1].share})`);
  ok(types[2].percent === 12.5 && types[2].share === 0.125, 'a fraction of a per cent divides cleanly too');
  ok(waterHarmTypes(null).length === 0 && waterHarmTypes({ rows: [] }).length === 0, 'no table, or an empty one, gives no kinds of water and does not throw');
  ok(waterHarmTypes({ rows: [{}] })[0].share === 0 && waterHarmTypes({ rows: [{}] })[0].damage === false, 'a row missing every column is harmless rather than NaN');
  // The seam: these are the names the game's own reader of the block looks for. A row whose `damage`
  // is spelled otherwise reads as doing none, which is silent, so the spelling is pinned on this
  // side as well as on that one.
  ok(['type', 'damage', 'kills', 'intervalSeconds', 'percent', 'share'].every((k) => k in types[1]), `a row is written under the names the game reads (${Object.keys(types[1]).join(', ')})`);
}
{
  const rows = waterImmunity(parseDatatable(parseIff(Buffer.from(encode(creatureValues)))), (p: string) => vfs.has(p));
  ok(rows.length === 4, 'every row of the immunity table comes back, joined or not');
  ok(rows[0].template === 'object/mobile/vehicle/test_float_skiff.iff' && rows[0].shared === 'object/mobile/vehicle/shared_test_float_skiff.iff' && rows[0].id === 'test_float_skiff', `a row is joined to the shared template beside it and reduced to the name a pack is keyed on (${rows[0].id})`);
  ok(rows[1].shared === 'object/mobile/som/shared_test_ember_bug.iff' && rows[1].resistance === 50, 'the join is the file\'s own name whatever folder it is in, and the resistance is the table\'s own number');
  ok(rows[2].shared === null && rows[2].id === 'test_absent_rider', 'a row with no shared template in the archives is kept, with its id, so it can be reported as a miss rather than vanishing');
  ok(rows[3].template === 'object/mobile/vehicle/test_caps_rider.iff' && rows[3].shared !== null, 'backslashes and capitals in a path are no reason to miss the join');
  ok(waterImmunity(null).length === 0 && waterImmunity({ rows: [{ object_template_name: 'a/b.iff' }] })[0].shared === null, 'no table gives no rows, and with no way to ask the archives nothing joins');
}
{
  const notes: string[] = [];
  const harm = readWaterHarm(vfs, notes)!;
  ok(harm.source === 'client' && harm.typeFrom === 'row', 'the block says whose numbers these are and how the water type was arrived at');
  ok(harm.files.types === WATER_VALUES && harm.files.immune === CREATURE_WATER_VALUES, 'and names the two files it read');
  ok(harm.types.length === 3 && harm.immune.length === 4 && notes.length === 0, 'both tables are read and nothing is remarked on when both are there');

  const only = { has: (p: string) => p === WATER_VALUES, read: () => files.get(WATER_VALUES)!, list: () => [] as string[] };
  const half: string[] = [];
  const one = readWaterHarm(only, half)!;
  ok(one.types.length === 3 && one.immune.length === 0 && half.length === 1 && half[0].includes(CREATURE_WATER_VALUES), `one table missing leaves its own list empty and says so once (${half[0]})`);

  const none = { has: () => false, read: () => Buffer.alloc(0), list: () => [] as string[] };
  const both: string[] = [];
  ok(readWaterHarm(none, both) === null && both.length === 2, 'with neither table there is no block at all, and both are named');

  const broken = { has: (p: string) => p === WATER_VALUES, read: () => Buffer.from('not an iff at all'), list: () => [] as string[] };
  const why: string[] = [];
  ok(readWaterHarm(broken, why) === null && why.length === 2, 'a table that will not parse is a note, not a throw');

  const lines = waterHarmLines(harm);
  ok(lines[0].includes('3 rows') && lines[0].includes('molten 40% every 2s, kills') && lines[0].includes('calm unharmed'), `the run says what each kind of water does (${lines[0]})`);
  ok(lines[1].includes('4 rows, 3 joined') && lines[1].includes('1 not'), `and how many templates joined (${lines[1]})`);
  ok(lines.some((l) => l.includes('test_float_skiff, test_ember_bug')) && lines.some((l) => l.includes('test_absent_rider') && l.includes('no shared template')), 'naming the ones that joined and the one that did not');
  ok(waterHarmLines(null).length === 1, 'and with no tables at all it says that in one line');
}
{
  const withHarm = JSON.parse(readFileSync(join(out, 'water.json'), 'utf8'));
  ok(withHarm.harm?.source === 'client' && withHarm.harm.types.length === 3 && withHarm.harm.immune.length === 4, 'the block rides in every planet\'s water.json, read by the exporter itself when it is not handed one');

  const given = mkdtempSync(join(tmpdir(), 'water-harm-'));
  const notes: string[] = [];
  exportWater(vfs, 'handed', [], template, given, { log: (m: string) => notes.push(m), harm: { source: 'client', files: { types: 'a', immune: 'b' }, typeFrom: 'row', types: [], immune: [] } });
  ok(JSON.parse(readFileSync(join(given, 'water.json'), 'utf8')).harm.files.types === 'a', 'a block read once for the whole run is written to every planet as it stands');

  const without = mkdtempSync(join(tmpdir(), 'water-noharm-'));
  exportWater(vfs, 'dry', [], template, without, { log: () => {}, harm: null });
  const bare = JSON.parse(readFileSync(join(without, 'water.json'), 'utf8'));
  ok(bare.harm === null && bare.notes.some((n: string) => n.includes('no harm block')), 'a run whose tables could not be read writes the block as null and says so in the pack');
}
{
  const lava = { kind: 'lava' };
  const water = { kind: 'water' };
  const harm = { source: 'client' };
  ok(waterPackNeedsHarm({ shaders: { a: lava, b: water } }), 'a pack with lava in it and no water values is asked for again');
  ok(!waterPackNeedsHarm({ shaders: { a: lava }, harm }), 'one that has them is not');
  ok(!waterPackNeedsHarm({ shaders: { a: water, b: water } }), 'and a pack with no lava at all is never asked, since nothing there could burn anyone');
  ok(!waterPackNeedsHarm({ shaders: {} }) && !waterPackNeedsHarm(null) && !waterPackNeedsHarm('x') && !waterPackNeedsHarm({ shaders: { a: null } }), 'an empty, absent or malformed pack asks for nothing');
}

// --- the pieces the exporter is built from -----------------------------------------------------

ok(linearToSrgbHex(meanLinear({ width: 2, height: 1, rgba: new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]) })) === '#bcbcbc', 'a black and a white texel average to mid grey in linear light, not to #808080');
ok(round3(meanLinear({ width: 1, height: 1, rgba: new Uint8Array([10, 20, 30, 128]) })[3]) === 0.502, 'alpha is averaged as it is stored');
ok(normalSlope({ width: 1, height: 1, rgba: new Uint8Array([128, 128, 255, 255]) }) < 0.006, 'a flat normal has almost no slope');
ok(['effect/water_lava.eft', 'effect/water_lava_textured.eft', 'effect\\lava.eft'].every(isLavaEffect) && !isLavaEffect('effect/water.eft') && !isLavaEffect(null), 'the lava effects are told from the water effect');
{
  const small = dds(4, 4, [solid(4, 4, [255, 0, 0, 255]), halves(4, [200, 0, 0, 255], [0, 0, 200, 255]), solid(4, 4, [0, 255, 0, 255]), solid(4, 4, [1, 1, 1, 255]), solid(4, 4, [2, 2, 2, 255]), solid(4, 4, [3, 3, 3, 255])]);
  const { faces, size, source } = cubeFaces(small, 256);
  ok(faces.map((f) => f.suffix).join() === 'px,nx,py,ny,pz,nz' && size === 4 && source === 4, 'cubeFaces names the faces in the game\'s order and reports the source size');
  ok(faces[0].img.rgba[2] === 200 && faces[0].img.rgba[(4 * 4 - 1) * 4] === 200, 'cubeFaces swaps the two X faces and mirrors every face, as the sky exporter always did');
}

// --- what the game makes of it (src/world/waterLook.ts) ----------------------------------------

ok(readWaterPack(null) === null && readWaterPack('x') === null && readWaterPack({}) === null, 'anything that is not a pack of shaders reads as null');
{
  const read = readWaterPack(pack)!;
  ok(read.version === 1 && Object.keys(read.shaders).length === 9 && read.global?.shader === 'wter_test', 'the game reads back every entry the converter wrote');
  ok(JSON.stringify(read.shaders.wter_lava_test.lava) === JSON.stringify(pack.shaders.wter_lava_test.lava), 'and a lava block rides through as written');
  const junk = readWaterPack({ version: 1, shaders: { a: { kind: 'water', color: 5, opacity: 0.4, cube: { faces: ['x'] }, lava: { ramp: 'r' } }, b: { color: '#ffffff' }, c: 7 } })!;
  ok(Object.keys(junk.shaders).join() === 'a', 'an entry without a kind, and anything that is not an object, is dropped');
  ok(junk.shaders.a.color === undefined && junk.shaders.a.opacity === 0.4, 'a colour that is not #rrggbb is dropped and the rest of its entry kept');
  ok(junk.shaders.a.cube === undefined, 'a cube without six faces is dropped');
  ok((junk.shaders.a as { lava?: { ramp: string } }).lava?.ramp === 'r', 'fields this design does not know (the lava block) survive untouched');
}
{
  const water: WaterShaderInfo = { kind: 'water', waterTypes: [0], tables: 1, global: false };
  const lava: WaterShaderInfo = { kind: 'lava', waterTypes: [0], tables: 1, global: false };
  ok(isLavaWater('wter_spec', 1, undefined), 'water type 1 is lava whatever the pack says');
  ok(isLavaWater('wter_lava_01_still', 0, lava), 'a type-0 table whose entry says lava is lava');
  ok(!isLavaWater('wter_lava_01_still', 0, water), 'an entry that says water wins over the name');
  ok(isLavaWater('wter_lava_01_still', 0, undefined), 'with no entry at all the name decides, so a pack converted before this still gets lava right');
  ok(!isLavaWater(null, 0, undefined), 'a table with no shader and no entry is water');
  ok(!isLavaWater('lava_like', 0, water), 'a type-0 table whose entry says water is water, whatever its name');
  ok(!isLavaWater('wter_spec', 0, undefined), 'a water shader with no entry is water');
}
{
  const read = readWaterPack(pack)!;
  const planet = { color: 0x2e7fbb, opacity: 0.75 };
  const shaderLook = waterLookFor('wter_test', read, planet);
  ok(shaderLook.color === '#6a8983' && shaderLook.opacity === 0.753 && shaderLook.ripple === 0.525 && shaderLook.drift === 0.5 && shaderLook.source === 'shader', `a body takes its own shader's look (${JSON.stringify(shaderLook)})`);
  ok(shaderLook.cube?.length === 6, 'and the faces of its own cube');
  ok(waterLookFor('wter_lava_test', read, planet).cube === null, 'a lava entry offers no cube to reflect');
  const planetLook = waterLookFor('nothing_like_this', read, planet);
  ok(planetLook.color === '#2e7fbb' && planetLook.opacity === 0.75 && planetLook.source === 'planet' && planetLook.ripple === 1, 'a shader with no entry falls back to the planet\'s own water');
  const bare = waterLookFor(null, null, null);
  ok(bare.color === '#2e7fbb' && bare.opacity === 0.75 && bare.source === 'default' && bare.shader === null, 'with no pack and no planet there is still a look');
  ok(waterLookFor('wter_gone', read, planet).source === 'planet', 'a missing shader has no colour of its own, so the planet\'s is used');
}
ok(envLightFrom(0.5, 0.5) === 1 && envLightFrom(0.9, 0.5) === 1, 'at its brightest, and beyond, a static cube is shown in full');
ok(envLightFrom(0.0001, 1) === 0.12 && round3(envLightFrom(0.036, 1)) === 0.19, `at night a static cube is dimmed but never put out (${round3(envLightFrom(0.036, 1))})`);
ok(envLightFrom(0.3, 0) === 1, 'without a ramp to compare against nothing is dimmed');

// --- is any water on screen (src/world/waterVisibility.ts) --------------------------------------

{
  let available = false;
  let result = 0;
  const gl = {
    QUERY_RESULT_AVAILABLE: 1,
    QUERY_RESULT: 2,
    ANY_SAMPLES_PASSED_CONSERVATIVE: 3,
    createQuery: () => ({}) as WebGLQuery,
    deleteQuery: () => {},
    beginQuery: () => {},
    endQuery: () => {},
    getQueryParameter: (_q: WebGLQuery, p: number) => (p === 1 ? available : result),
  } as unknown as WebGL2RenderingContext;

  const v = new WaterVisibility();
  ok(v.state === 'unknown' && !v.measure(() => {}), 'before a context is attached nothing is measured and water counts as visible');
  v.poll();
  v.poll();
  ok(v.age === 0, 'frames in which nothing is known and nothing is asked are not an age');
  v.attach(gl);
  let draws = 0;
  ok(v.measure(() => draws++) && draws === 1, 'measuring draws once inside a query');
  ok(!v.measure(() => draws++) && draws === 1, 'a second question is not asked while the first is out');
  v.poll();
  ok(v.state === 'unknown', 'an answer that is not ready leaves the state alone');
  available = true;
  result = 0;
  v.poll();
  ok(v.state === 'hidden' && v.age === 0, 'a query that passed no samples says the water is hidden');
  result = 1;
  ok(v.measure(() => draws++) && draws === 2, 'once answered the next question may be asked');
  v.poll();
  ok(v.state === 'visible' && v.age === 0, 'a query that passed samples says the water is visible');

  v.measure(() => draws++);
  v.invalidate();
  v.poll();
  ok(v.state === 'unknown', 'an answer about a view that has emptied since is thrown away');

  available = false;
  ok(v.measure(() => draws++), 'and the question can be asked again');
  for (let i = 0; i < 60; i++) v.poll();
  ok(!v.measure(() => draws++), 'a query that has not answered yet still blocks the next one');
  v.poll();
  const before = draws;
  ok(v.measure(() => draws++) && draws === before + 1, 'a query that never answers (a lost context) is given up on and asked again');
  v.dispose();
  ok(v.state === 'unknown', 'disposing forgets the last answer');
}

// --- the order the mask draws the twins in (src/world/waterVisibility.ts) -----------------------

{
  // three's own transparent order (WebGLRenderLists.js, reversePainterSortStable), copied.
  const three = (a: WaterDrawKey, b: WaterDrawKey) => (a.group !== b.group ? a.group - b.group : a.order !== b.order ? a.order - b.order : a.z !== b.z ? b.z - a.z : a.id - b.id);
  let seed = 12345;
  const rand = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
  let agree = 0;
  for (let trial = 0; trial < 500; trial++) {
    const n = 1 + Math.floor(rand() * 12);
    const list = Array.from({ length: n + 3 }, (_, i) => ({ key: { group: Math.floor(rand() * 2), order: Math.floor(rand() * 3), z: Math.floor(rand() * 4) / 4, id: 100 + ((i * 7) % (n + 3)) } }));
    const tail = list.slice(n);
    const want = list.slice(0, n).sort((a, b) => three(a.key, b.key));
    sortByDraw(list, n);
    if (want.every((w, i) => w === list[i]) && tail.every((t, i) => t === list[n + i])) agree++;
  }
  ok(agree === 500, 'the twins are put in exactly the order three draws the lit meshes (ties on depth broken by id), and nothing past the count is touched');
  const sea = { key: { group: 0, order: 0, z: 0.99, id: 10 } };
  const lake = { key: { group: 0, order: 0, z: 0.4, id: 11 } };
  const pair = [lake, sea];
  sortByDraw(pair, 2);
  ok(pair[0] === sea && pair[1] === lake, 'a farther body is drawn first: the sea before a lake in front of it');
  ok(!drawsBefore(lake.key, sea.key) && drawsBefore({ ...lake.key, order: -1 }, sea.key) && drawsBefore({ ...sea.key, group: -1 }, { ...lake.key, order: -5 }), 'a lower render order goes first whatever the depth, and a lower group order before that');
}

ok([shaderKey('shader\\Wter_Spec.sht'), shaderKey('shader/x.sht'), shaderKey('WTER_SPEC'), shaderKey('')].join() === 'wter_spec,x,wter_spec,', 'the converter and the game reduce a shader name to the same key');

console.log(`${passed} checks passed`);
