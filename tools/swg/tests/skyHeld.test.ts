// The sky's held bodies and SWG's extra sky pictures in the converter (the GPU port's pass 2, wave 4b, maker B): an
// environment file's `GSCL` chunks (a celestial with a stage flag, which only Endor's late file carries), read into the sky's
// `held` list with each one's picture and stage; a ground world's distant appearances given their converted effect; a sky
// with neither writing `held: []` (so `status` can tell a sky converted before them); and the shared sky pack of the sweep's
// pictures (`<out>/sky/pictures.json`). Synthetic data throughout: no byte of SWG's files is held here.
//   node tools/swg/tests/skyHeld.test.ts
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { form, chunk, W, encode } from './iffWriter.ts';
import { parseIff } from '../iff.mjs';
import { SKY_PICTURES, SKY_PICTURES_VERSION, exportSky, exportSkyPictures, heldStageOf, parseEnvironmentFile, pictureName } from '../sky.mjs';

let passed = 0;
const ok = (cond: boolean, msg: string): void => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};

/** An uncompressed 32-bit DDS (BGRA in memory) of one colour. */
function dds(width: number, height: number, rgba: number[]): Buffer {
  const w = new W();
  w.str('DDS').parts.pop();
  w.u8(0x20);
  w.u32(124).u32(0x1 | 0x2 | 0x4 | 0x1000).u32(height).u32(width).u32(width * 4).u32(0).u32(1);
  for (let i = 0; i < 11; i++) w.u32(0);
  w.u32(32).u32(0x41).u32(0).u32(32).u32(0x00ff0000).u32(0x0000ff00).u32(0x000000ff).u32(0xff000000);
  w.u32(0x1000).u32(0).u32(0).u32(0).u32(0);
  const out = [...w.bytes()];
  for (let i = 0; i < width * height; i++) out.push(rgba[2], rgba[1], rgba[0], rgba[3]);
  return Buffer.from(out);
}

const files = new Map<string, Buffer>();
const put = (p: string, b: Uint8Array | Buffer): void => {
  files.set(p.toLowerCase(), Buffer.from(b));
};
const vfs = { has: (p: string) => files.has(p.toLowerCase()), read: (p: string) => files.get(p.toLowerCase())!, list: () => [] as string[] };

/** A `GSCL` chunk as the client lays it: a `CELS` (shader, size, glow shader, glow size, yaw, pitch, the pitch's direction, the cycle's seconds) and an int32 flag. */
const gscl = (shader: string, size: number, yaw: number, pitch: number, flag: number): ReturnType<typeof chunk> =>
  chunk('GSCL', new W().str(shader).f32(size).str('').f32(0).f32(yaw).f32(pitch).f32(1).f32(0).i32(flag).bytes());

// ---------------------------------------------------------------- 1. the reader
{
  ok(heldStageOf(2) === 1 && heldStageOf(4) === 2 && heldStageOf(8) === 3 && heldStageOf(0) === 0 && heldStageOf(6) === 0 && heldStageOf(16) === 0, 'a flag of one bit of 2, 4 or 8 is stage 1, 2 or 3; anything else stage 0');
  ok(pictureName('shader/moon_stageA.sht') === 'moon_stagea' && pictureName('texture\\Cels_Ship.DDS') === 'cels_ship' && pictureName(null) === '', "a picture's name is its file's, no folder, no extension, lower case");
  // Three bodies of one place in three stages (as Endor's file has them), beside an ordinary celestial and a distant one.
  const bytes = encode(form('ENVM', form('0000',
    chunk('MOON', new W().str('shader/moon.sht').f32(0.3).str('').f32(0).bytes()),
    chunk('CELS', new W().str('shader/planet.sht').f32(1).str('').f32(0).f32(30).f32(150).f32(1).f32(0).bytes()),
    gscl('shader/moon_stagea.sht', 0.55, 120, 25, 2),
    gscl('shader/moon_stageb.sht', 0.55, 120, 25, 4),
    gscl('shader/moon_stagec.sht', 0.55, 120, 25, 8),
    form('DIST', chunk('0000', new W().str('appearance/pt_far_plume.prt').f32(-10).f32(0).f32(20).f32(90).f32(0).f32(0).u8(0).i32(1).bytes())),
  )));
  const gsclChunk = gscl('shader/moon_stagea.sht', 0.55, 120, 25, 2) as { data: Uint8Array };
  ok(gsclChunk.data.length === 'shader/moon_stagea.sht'.length + 1 + 29, "a GSCL chunk is its shader's name and 29 bytes more: a celestial's 25 and the flag's 4 (Endor's are 56 bytes, a 27-byte name and 29)");
  const env = parseEnvironmentFile(parseIff(Buffer.from(bytes)))!;
  ok(env.celestials.length === 1 && env.celestials[0].shader === 'shader/planet.sht' && env.celestials[0].pitch === 150, 'the ordinary celestial is read as before, apart from the held ones');
  ok(env.held.length === 3 && env.held.map((h: { stage: number }) => h.stage).join() === '1,2,3' && env.held.map((h: { flag: number }) => h.flag).join() === '2,4,8', 'three held bodies, each with its flag and its stage');
  const h = env.held[0];
  ok(h.shader === 'shader/moon_stagea.sht' && Math.abs(h.size - 0.55) < 1e-6 && h.yaw === 120 && h.pitch === 25 && h.pitchDirection === 1 && h.cycleTime === 0 && h.glowShader === '' && h.glowSize === 0, "each held body's shader, size, yaw, pitch, the pitch's direction and cycle as a celestial's");
  ok(env.distant.length === 1 && env.distant[0].appearance === 'appearance/pt_far_plume.prt' && env.distant[0].direction.join() === '-10,0,20' && env.distant[0].orientation.join() === '90,0,0' && env.distant[0].infinite === false && env.distant[0].flag === 1, 'the distant appearance read as before');
  const none = parseEnvironmentFile(parseIff(Buffer.from(encode(form('ENVM', form('0000', chunk('MOON', new W().str('shader/moon.sht').f32(0.3).str('').f32(0).bytes())))))))!;
  ok(Array.isArray(none.held) && none.held.length === 0, 'a file with no GSCL holds none');
  // A chunk cut short of its flag is read as stage 0 (never a throw).
  const cut = parseEnvironmentFile(parseIff(Buffer.from(encode(form('ENVM', form('0000', chunk('GSCL', new W().str('shader/x.sht').f32(1).str('').f32(0).f32(1).f32(2).f32(1).f32(0).bytes())))))))!;
  ok(cut.held.length === 1 && cut.held[0].flag === 0 && cut.held[0].stage === 0, 'a GSCL cut short of its flag is stage 0');

  // ---------------------------------------------------------------- 2. the world's sky.json
  put('terrain/environment/heldworld.iff', bytes);
  for (const s of ['shader/moon.sht', 'shader/planet.sht', 'shader/moon_stagea.sht', 'shader/moon_stageb.sht', 'shader/moon_stagec.sht']) put(s, new Uint8Array(0));
  const textureFor = (p: string): { path: string; png: Buffer; alphaMode: string; hasAlpha: boolean } | null => (p.endsWith('.sht') ? { path: `texture/${p.slice(7, -4)}.dds`, png: Buffer.from([1, 2, 3]), alphaMode: 'BLEND', hasAlpha: true } : null);
  const out = mkdtempSync(join(tmpdir(), 'skyheld-'));
  const asked: string[] = [];
  const particleFor = (p: string): { file: string } => {
    asked.push(p);
    return { file: `particles/fx_${p.replace(/^.*\//, '').replace('.prt', '')}.json` };
  };
  const logs: string[] = [];
  exportSky(vfs, 'heldworld', out, { textureFor, particleFor, log: (m: string) => logs.push(m) });
  const sky = JSON.parse(readFileSync(join(out, 'sky.json'), 'utf8'));
  ok(Array.isArray(sky.held) && sky.held.length === 3, "the world's sky.json carries its three held bodies");
  ok(sky.held[0].picture === 'moon_stagea' && sky.held[0].image.file === 'sky/moon_stagea.png' && existsSync(join(out, 'sky/moon_stagea.png')) && sky.held[2].image.file === 'sky/moon_stagec.png', "each held body's picture written into the world's sky as a celestial's is, named by its SWG name");
  ok(sky.held[1].stage === 2 && sky.held[1].yaw === 120 && sky.held[1].pitch === 25 && Math.abs(sky.held[1].size - 0.55) < 1e-6, 'with its stage, yaw, pitch and size as the file gives them');
  ok(sky.celestials.length === 1 && sky.celestials[0].image.file === 'sky/planet.png', 'the celestials as before');
  ok(sky.distant.length === 1 && sky.distant[0].file === 'particles/fx_pt_far_plume.json' && asked.includes('appearance/pt_far_plume.prt'), "the distant appearance's effect converted into the pack and named by its file");
  ok(logs.some((m) => m.includes('3 held bodies') && m.includes('1 distant effects')), 'the log names the held bodies and the distant effects');
  const out2 = mkdtempSync(join(tmpdir(), 'skyheld2-'));
  exportSky(vfs, 'heldworld', out2, { textureFor, log: () => {} });
  const plain = JSON.parse(readFileSync(join(out2, 'sky.json'), 'utf8'));
  ok(plain.distant[0].file === null && plain.held.length === 3, 'without an effect converter the distant appearance keeps a null file');
  put('terrain/environment/plainworld.iff', encode(form('ENVM', form('0000', chunk('MOON', new W().str('shader/moon.sht').f32(0.3).str('').f32(0).bytes())))));
  const out3 = mkdtempSync(join(tmpdir(), 'skyheld3-'));
  exportSky(vfs, 'plainworld', out3, { textureFor, particleFor, log: () => {} });
  const p3 = JSON.parse(readFileSync(join(out3, 'sky.json'), 'utf8'));
  ok(Array.isArray(p3.held) && p3.held.length === 0 && Array.isArray(p3.distant) && p3.distant.length === 0, 'a world with neither writes held: [] (so a sky converted before them is told apart)');
}

// ---------------------------------------------------------------- 3. the shared sky pack
{
  ok(SKY_PICTURES.length === 11 && new Set(SKY_PICTURES.map((p) => p.name)).size === 11, "the sweep's eleven pictures, each once");
  ok(SKY_PICTURES.filter((p) => p.use === 'held').map((p) => p.name).join() === 'moon_deathstar1,moon_deathstar2,moon_deathstar3,moon_deathstar,cels_moncal_cruiser,cels_star_destroyer', 'six a world may hold: the four stages of the station and the two ships');
  ok(SKY_PICTURES.filter((p) => p.use === 'fallback').map((p) => p.name).join() === 'moon_taan,cels_earth_01,pln_ice_planetoid_main,pln_lok_mask,pln_lok_detail_02', "five for the viewer's fallbacks");
  // Two of them in a synthetic archive (one too wide, halved), the rest missing.
  put('texture/moon_deathstar1.dds', dds(4, 4, [200, 100, 50, 255]));
  put('texture/cels_earth_01.dds', dds(2048, 4, [10, 20, 30, 128]));
  const root = mkdtempSync(join(tmpdir(), 'skypics-'));
  const logs: string[] = [];
  const r = exportSkyPictures(vfs, root, { log: (m: string) => logs.push(m), late: { stamp: 'test' } });
  ok(r.written.join() === 'moon_deathstar1,cels_earth_01' && r.missing.length === 9, 'what the archives hold is written, what they do not is named');
  const list = JSON.parse(readFileSync(join(root, 'sky', 'pictures.json'), 'utf8'));
  ok(list.version === SKY_PICTURES_VERSION && list.pictures.moon_deathstar1.file === 'moon_deathstar1.png' && list.pictures.moon_deathstar1.use === 'held' && existsSync(join(root, 'sky', 'moon_deathstar1.png')), 'the list names each picture with its file and use, beside it under sky/');
  ok(list.pictures.cels_earth_01.width === 1024 && list.pictures.cels_earth_01.height === 2 && list.late.stamp === 'test', 'a picture wider than 1024 is halved until it is not; the late stamp kept');
  ok(logs.some((m) => m.includes('2 of 11')), 'the log says how many were written');
}

console.log(`${passed} checks passed`);
