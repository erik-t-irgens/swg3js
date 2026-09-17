// Sky exporter on synthetic data: an ENVM environment file, an environment datatable, a colour
// ramp TGA, a gradient sky DDS and a cube map DDS whose faces come out swapped and mirrored.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { form, chunk, W, encode } from './iffWriter.ts';
import { parseIff } from '../iff.mjs';
import { cameraEffectKind, cameraEffectStrength, exportSky, parseEnvironmentFile } from '../sky.mjs';
import { decodeDdsCube, isDdsCube } from '../dds.mjs';

let passed = 0;
const ok = (cond: boolean, msg: string) => { assert.ok(cond, msg); passed++; console.log(`ok   ${msg}`); };

/** An uncompressed 32-bit DDS (BGRA in memory), optionally a cube map of six faces. */
function dds(width: number, height: number, faces: Uint8Array[]): Buffer {
  const w = new W();
  w.str('DDS').parts.pop(); // "DDS " magic: drop the NUL, add the space
  w.u8(0x20);
  w.u32(124).u32(0x1 | 0x2 | 0x4 | 0x1000).u32(height).u32(width).u32(width * 4).u32(0).u32(1);
  for (let i = 0; i < 11; i++) w.u32(0);
  w.u32(32).u32(0x41).u32(0).u32(32).u32(0x00ff0000).u32(0x0000ff00).u32(0x000000ff).u32(0xff000000);
  w.u32(0x1000 | (faces.length > 1 ? 0x8 : 0)).u32(faces.length > 1 ? 0x200 | 0xfc00 : 0).u32(0).u32(0).u32(0);
  const out = [...w.bytes()];
  for (const f of faces) for (let i = 0; i < f.length; i += 4) out.push(f[i + 2], f[i + 1], f[i], f[i + 3]); // RGBA -> BGRA
  return Buffer.from(out);
}
function solid(width: number, height: number, rgba: number[]): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) out.set(rgba, i * 4);
  return out;
}

const files = new Map<string, Buffer>();
const put = (p: string, b: Uint8Array | Buffer) => files.set(p.toLowerCase(), Buffer.from(b));
const vfs = { has: (p: string) => files.has(p.toLowerCase()), read: (p: string) => files.get(p.toLowerCase())!, list: () => [] as string[] };

// environment file
put('terrain/environment/test.iff', encode(form('ENVM', form('0000',
  chunk('SUN ', new W().str('shader/sun.sht').f32(0.5).str('shader/sun_glow.sht').f32(1.5).bytes()),
  chunk('MOON', new W().str('shader/moon.sht').f32(0.3).str('').f32(0).bytes()),
  chunk('STAR', new W().str('texture/star_colors.tga').i32(1500).bytes()),
  chunk('TLOK', new W().u8(0).f32(0).bytes()),
  chunk('CELS', new W().str('shader/planet.sht').f32(0.8).str('').f32(0).f32(30).f32(45).f32(1).f32(0).bytes()),
))));
// colour ramp: 256 x 8, row 6 (fog) blue with alpha = column (star alpha)
{
  const w = 256, h = 8;
  const tga = new W().u8(0).u8(0).u8(2).u16(0).u16(0).u8(0).u16(0).u16(0).u16(w).u16(h).u8(32).u8(0x28);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (y === 6) tga.u8(200).u8(50).u8(10).u8(x); // BGRA
    else tga.u8(y * 30).u8(y * 30).u8(y * 30).u8(255);
  }
  put('texture/ramp.tga', tga.bytes());
  const stars = new W().u8(0).u8(0).u8(2).u16(0).u16(0).u8(0).u16(0).u16(0).u16(4).u16(1).u8(32).u8(0x28);
  for (let x = 0; x < 4; x++) stars.u8(255).u8(255).u8(255).u8(255);
  put('texture/star_colors.tga', stars.bytes());
}
put('texture/sky_gradient.dds', dds(4, 2, [solid(4, 2, [10, 20, 30, 0])]));
// cube map: +X red, -X green, +Y blue with a bright left column, others grey
{
  const px = solid(2, 2, [255, 0, 0, 255]);
  const nx = solid(2, 2, [0, 255, 0, 255]);
  const py = solid(2, 2, [0, 0, 255, 255]);
  py.set([255, 255, 255, 255], 0); // top-left texel bright
  const grey = solid(2, 2, [128, 128, 128, 255]);
  put('texture/env_day.dds', dds(2, 2, [px, nx, py, grey, grey, grey]));
}
// environment table: 25 columns in the client's order
const cols = ['name', 'weatherIndex', 'gradientSkyTextureName', 'cloudLayerBottomShaderTemplateName', 'cloudLayerBottomShaderSize', 'cloudLayerBottomSpeed', 'cloudLayerTopShaderTemplateName', 'cloudLayerTopShaderSize', 'cloudLayerTopSpeed', 'colorRampFileName', 'shadowsEnabled', 'fogEnabled', 'minimumFogDensity', 'maximumFogDensity', 'cameraAppearanceTemplateName', 'dayEnvironmentTextureName', 'nightEnvironmentTextureName', 'day1AmbientSoundTemplateName', 'day2AmbientSoundTemplateName', 'night1AmbientSoundTemplateName', 'night2AmbientSoundTemplateName', 'firstMusicSoundTemplateName', 'sunriseMusicSoundTemplateName', 'sunsetMusicSoundTemplateName', 'windSpeedScale'];
const types = ['s', 'i', 's', 's', 'f', 'f', 's', 'f', 'f', 's', 'i', 'i', 'f', 'f', 's', 's', 's', 's', 's', 's', 's', 's', 's', 's', 'f'];
// Column 14 is the camera effect, 17-20 the ambient sounds and 21-23 the music cues.
const row = new W().str('test_default').i32(0).str('texture/sky_gradient.dds').str('').f32(0).f32(0).str('').f32(0).f32(0).str('texture/ramp.tga').i32(1).i32(1).f32(0.0005).f32(0.002).str('appearance/pt_rain_sheet_heavy.prt').str('texture/env_day.dds').str('')
  .str('sound/day_one.snd').str('').str('sound/night_one.snd').str('').str('sound/music_first.snd').str('').str('').f32(1);
put('datatables/environment/test.iff', encode(form('DTII', form('0001',
  chunk('COLS', cols.reduce((w, c) => w.str(c), new W().i32(cols.length)).bytes()),
  chunk('TYPE', types.reduce((w, t) => w.str(t), new W()).bytes()),
  chunk('ROWS', new Uint8Array([...new W().i32(1).bytes(), ...row.bytes()]))))));

for (const sh of ['shader/sun.sht', 'shader/sun_glow.sht', 'shader/moon.sht', 'shader/planet.sht']) put(sh, new Uint8Array(0));
// The row's own camera effect, which is also the heaviest of the forceable rain effects; the
// lighter two are absent, so the pack must carry nulls for them.
put('appearance/pt_rain_sheet_heavy.prt', new Uint8Array(0));

const env = parseEnvironmentFile(parseIff(vfs.read('terrain/environment/test.iff')));
ok(env!.sun!.shader === 'shader/sun.sht' && Math.abs(env!.sun!.size - 0.5) < 1e-6 && env!.sun!.glowSize === 1.5, 'environment file: sun and glow');
ok(env!.stars!.count === 1500 && env!.celestials.length === 1 && env!.celestials[0].yaw === 30, 'environment file: stars and extra celestial');

const out = mkdtempSync(join(tmpdir(), 'sky-'));
const pngs = new Map<string, Uint8Array>();
const textureFor = (p: string) => (p === 'shader/sun.sht' || p === 'shader/moon.sht' || p === 'shader/sun_glow.sht' || p === 'shader/planet.sht' ? { path: `texture/${p.slice(7, -4)}.dds`, png: Buffer.from([1, 2, 3]), alphaMode: 'BLEND', hasAlpha: true } : null);
const logs: string[] = [];
const particleFor = (p: string) => ({ file: `particles/fx_${p.replace(/^.*\//, '').replace('.prt', '')}.json` });
exportSky(vfs, 'test', out, { textureFor, particleFor, log: (m: string) => logs.push(m) });
const sky = JSON.parse(readFileSync(join(out, 'sky.json'), 'utf8'));
ok(sky.sun.image.file === 'sky/sun.png' && existsSync(join(out, 'sky/sun.png')) && sky.sun.glowImage.file === 'sky/sun_glow.png', 'sun textures written');
ok(sky.blocks.length === 1 && sky.blocks[0].name === 'test_default' && sky.blocks[0].fog.enabled && Math.abs(sky.blocks[0].fog.max - 0.002) < 1e-6, 'environment block from the table');
ok(sky.blocks[0].gradientSky === 'sky/sky_gradient.png' && existsSync(join(out, 'sky/sky_gradient.png')), 'gradient sky texture written');
const ramp = Buffer.from(sky.blocks[0].ramp.rgba, 'base64');
ok(sky.blocks[0].ramp.rows === 8 && ramp.length === 256 * 8 * 4 && ramp[(6 * 256 + 100) * 4] === 10 && ramp[(6 * 256 + 100) * 4 + 2] === 200 && ramp[(6 * 256 + 100) * 4 + 3] === 100, 'colour ramp rows decoded top-down as RGBA');
ok(sky.stars.count === 1500 && sky.stars.colors.width === 4, 'star colours kept');
const cube = sky.blocks[0].dayEnvironment;
ok(cube && cube.faces.length === 6 && cube.faces[0] === 'sky/env_day_px.png', 'reflection cube map faces written');
ok(isDdsCube(vfs.read('texture/env_day.dds')) && decodeDdsCube(vfs.read('texture/env_day.dds')).faces[1].rgba.slice(0, 3).join() === '0,255,0', 'cube DDS faces decode in order');
// the written +X face must be the game's -X (green), mirrored; +Y keeps blue with the bright texel now top-right
/** Our encoder writes filter-0 rows in one zlib stream, so decoding is inflate and strip. */
const { inflateSync } = await import('node:zlib');
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
  const px = decodePng(readFileSync(join(out, 'sky/env_day_px.png')));
  ok(px.rgba[1] === 255 && px.rgba[0] === 0, 'written +X face is the game\'s -X');
  const py = decodePng(readFileSync(join(out, 'sky/env_day_py.png')));
  ok(py.rgba[4] === 255 && py.rgba[5] === 255 && py.rgba[0] === 0, 'faces are mirrored horizontally');
}

// --- weather: the row's camera effect and sounds, and the effects every pack carries
ok(JSON.stringify(sky.blocks[0].cameraEffect) === JSON.stringify({ source: 'appearance/pt_rain_sheet_heavy.prt', file: 'particles/fx_pt_rain_sheet_heavy.json', kind: 'rain', strength: 1 }), 'the row\'s camera effect is converted and described');
ok(sky.blocks[0].sounds.day[0] === 'sound/day_one.snd' && sky.blocks[0].sounds.day[1] === null && sky.blocks[0].sounds.night[0] === 'sound/night_one.snd' && sky.blocks[0].sounds.music.first === 'sound/music_first.snd' && sky.blocks[0].sounds.music.sunset === null, 'the row\'s ambient sounds and music are kept');
ok(sky.weather.levels === 1 && sky.weather.effects.rain[2] === 'particles/fx_pt_rain_sheet_heavy.json' && sky.weather.effects.rain[0] === null && sky.weather.effects.rain[1] === null && sky.weather.effects.dust.every((f: string | null) => f === null) && sky.weather.effects.snow.length === 2, 'the pack carries the forceable effects it has, and nulls for the rest');
ok(logs.some((m) => m.includes('1 camera effect (rain)')), 'the log names the camera effects');
{
  const kinds = ['pt_rain_sheet_verylight.prt', 'pt_rain_sheet_light.prt', 'pt_rain_sheet_heavy.prt', 'pt_dust_storm_light.prt', 'pt_dust_storm.prt', 'pt_dust_storm_heavy.prt', 'pt_dust_storm_heavy_a1.prt', 'pt_snow_lifeday.prt', 'pt_snow_storm_heavy.prt', 'pt_fog.prt', 'pt_fog_kashyyyk_01.prt', 'pt_falling_leaf.prt', 'must_lightning_2.prt', 'a1-lighting.prt', 'pt_lava_additive_smoke.prt']
    .map((n) => cameraEffectKind(`appearance/${n}`)).join(',');
  ok(kinds === 'rain,rain,rain,dust,dust,dust,dust,snow,snow,fog,fog,leaves,lightning,lightning,smoke', `every camera effect in the tables is classified (${kinds})`);
  const strengths = ['pt_rain_sheet_verylight.prt', 'pt_dust_storm_light.prt', 'pt_dust_storm.prt', 'pt_dust_storm_heavy.prt'].map((n) => cameraEffectStrength(n)).join(',');
  ok(strengths === '0.35,0.6,0.7,1', `strength reads the name (${strengths})`);
}
{
  const out2 = mkdtempSync(join(tmpdir(), 'sky2-'));
  exportSky(vfs, 'test', out2, { textureFor, log: () => {} });
  const plain = JSON.parse(readFileSync(join(out2, 'sky.json'), 'utf8'));
  ok(plain.blocks[0].cameraEffect.source === 'appearance/pt_rain_sheet_heavy.prt' && plain.blocks[0].cameraEffect.file === null && plain.weather.effects.rain.every((f: string | null) => f === null), 'without a converter the effects are named but no file is written');
}
console.log(`${passed} checks passed`);
