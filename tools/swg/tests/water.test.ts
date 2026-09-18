// The water exporter on synthetic shaders: colours and opacity from a MAIN texture's mean taken in
// linear light, ripple from a normal map's slope, drift from the TSNS scroll rate, a cube map
// written as six mirrored PNGs, and lava told from water by effect, by water type and by name.
// Also the game's own reader of what it writes (src/world/waterLook.ts) and the occlusion-query
// state machine that decides whether any water is on screen (src/world/waterVisibility.ts).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { form, chunk, W, encode } from './iffWriter.ts';
import { cubeFaces } from '../sky.mjs';
import { exportWater, isLavaEffect, linearToSrgbHex, meanLinear, normalSlope, REFERENCE_SCROLL, REFERENCE_SLOPE, WATER_CUBE_SIZE } from '../water.mjs';
import { envLightFrom, isLavaWater, readWaterPack, shaderKey, waterLookFor, type WaterShaderInfo } from '../../../src/world/waterLook.ts';
import { WaterVisibility } from '../../../src/world/waterVisibility.ts';

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
put('shader/wter_lava_test.sht', sht('effect/water_lava_textured.eft', [txm('MAIN', 'texture\\wter_main.dds'), txm('CUBE', 'texture\\env_test.dds')]));
put('shader/wter_test_as_lava.sht', sht('effect\\water.eft', [txm('MAIN', 'texture\\wter_main.dds'), txm('NRML', 'texture\\wter_test_n.dds')]));

const uses = [
  { shader: 'wter_test', waterTypes: [0], tables: 2, global: true },
  { shader: 'wter_share', waterTypes: [0], tables: 1, global: false },
  { shader: 'wter_calm', waterTypes: [0], tables: 1, global: false },
  { shader: 'wter_nocube', waterTypes: [0], tables: 1, global: false },
  { shader: 'wter_lava_test', waterTypes: [0], tables: 1, global: false },
  { shader: 'wter_test_as_lava', waterTypes: [1], tables: 1, global: false },
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
ok(pack.notes.some((n: string) => n.includes('wter_gone')) && logs.some((l) => l.includes('8 shaders (5 water, 3 lava), 1 cubes')), `the log counts water, lava and cubes (${logs[0]})`);

{
  const empty = mkdtempSync(join(tmpdir(), 'water-dry-'));
  exportWater(vfs, 'dry', [], { useGlobalWaterTable: false, globalWaterTableHeight: 0, globalWaterTableShaderSize: 2 }, empty, { log: () => {} });
  const dry = JSON.parse(readFileSync(join(empty, 'water.json'), 'utf8'));
  ok(Object.keys(dry.shaders).length === 0 && dry.global === null, 'a planet with no water still gets a water.json, so status only has to see the file');
  ok(!existsSync(join(empty, 'water')), 'and no empty water folder is made for it');
}
{
  // Lava carries no cube, so a planet whose every shader is lava writes no face and must be left
  // without a water/ folder as well: the folder is made where the first face is written, not for
  // the planet having shaders at all.
  const molten = mkdtempSync(join(tmpdir(), 'water-lava-'));
  exportWater(vfs, 'lavaplanet', [{ shader: 'wter_lava_test', waterTypes: [0], tables: 3, global: false }, { shader: 'lava_gone', waterTypes: [0], tables: 1, global: false }], template, molten, { log: () => {} });
  const all = JSON.parse(readFileSync(join(molten, 'water.json'), 'utf8'));
  ok(all.shaders.wter_lava_test.kind === 'lava' && all.shaders.lava_gone.kind === 'lava' && !existsSync(join(molten, 'water')), 'a planet whose shaders are all lava gets its water.json and no empty water folder either');
}
{
  // Every write goes through the injected writer, so the faces of a shared cube can be counted.
  const counted = mkdtempSync(join(tmpdir(), 'water-count-'));
  const wrote: string[] = [];
  exportWater(vfs, 'testplanet', uses, template, counted, { log: () => {}, writeFile: (p: string) => wrote.push(p) });
  const faces = wrote.filter((p) => p.includes('env_test_'));
  ok(faces.length === 6, `a cube two shaders both name is written once (${faces.length} face writes)`);
  ok(wrote.filter((p) => p.endsWith('water.json')).length === 1 && wrote.length === 7, `nothing else is written (${wrote.length} files)`);
  ok(readdirSync(join(out, 'water')).length === 6, 'and only those six PNGs are on disk');
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
  ok(read.version === 1 && Object.keys(read.shaders).length === 8 && read.global?.shader === 'wter_test', 'the game reads back every entry the converter wrote');
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

ok([shaderKey('shader\\Wter_Spec.sht'), shaderKey('shader/x.sht'), shaderKey('WTER_SPEC'), shaderKey('')].join() === 'wter_spec,x,wter_spec,', 'the converter and the game reduce a shader name to the same key');

console.log(`${passed} checks passed`);
