// Animated and glowing surfaces in the converter, on synthetic shaders, effects, programs and images:
// flip-books (SWTS, SWSH) and their timing forms, texture scroll and split alpha, the effect pass read
// at its version's offsets, the glow split in linear light, the decision surfaceTexture makes, and
// what buildGlb writes for it (samplers, KHR_materials_unlit, extras.swg).
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { form, chunk, W, encode } from './iffWriter.ts';
import { parseIff } from '../iff.mjs';
import { decodeDds } from '../dds.mjs';
import { encodePng } from '../png.mjs';
import { effectAlphaMode } from '../sht.mjs';
import { effectAlpha, alphaModeFor } from '../eff.mjs';
import { buildGlb } from '../glb.mjs';
import { readFileSync } from 'node:fs';
import {
  MATERIAL_FORMAT, alphaModeFor as surfaceAlphaModeFor, alphaAsGrey, describeLines, describeSurface, emissiveOf, fitRgba, isSplitAlpha, maskOf, passState, rgbOnly,
  scrollSets, shaderPathOf, splitGlow, surfaceCounts, surfaceCountsLine, surfaceLine, surfaceTexture, timingOf,
} from '../surface.mjs';

let passed = 0;
const ok = (cond: boolean, msg: string) => { assert.ok(cond, msg); passed++; console.log(`ok   ${msg}`); };
const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;

// --- fixtures -------------------------------------------------------------------------------

/** An uncompressed 32-bit DDS (BGRA on disk) from RGBA bytes. */
function dds(width: number, height: number, rgba: number[] | Uint8Array): Buffer {
  const w = new W();
  w.str('DDS').parts.pop();
  w.u8(0x20);
  w.u32(124).u32(0x1 | 0x2 | 0x4 | 0x1000).u32(height).u32(width).u32(width * 4).u32(0).u32(1);
  for (let i = 0; i < 11; i++) w.u32(0);
  w.u32(32).u32(0x41).u32(0).u32(32).u32(0x00ff0000).u32(0x0000ff00).u32(0x000000ff).u32(0xff000000);
  w.u32(0x1000).u32(0).u32(0).u32(0).u32(0);
  const body = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) { body[i * 4] = rgba[i * 4 + 2]; body[i * 4 + 1] = rgba[i * 4 + 1]; body[i * 4 + 2] = rgba[i * 4]; body[i * 4 + 3] = rgba[i * 4 + 3]; }
  return Buffer.concat([Buffer.from(w.bytes()), body]);
}
const solid = (n: number, rgba: number[]) => { const out: number[] = []; for (let i = 0; i < n; i++) out.push(...rgba); return out; };

/** Read back what encodePng wrote (8-bit RGBA, filter 0 on every row). */
function readPng(png: Buffer) {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  let o = 8;
  const idat: Buffer[] = [];
  while (o < png.length) {
    const len = png.readUInt32BE(o);
    const type = png.toString('latin1', o + 4, o + 8);
    if (type === 'IDAT') idat.push(png.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) rgba.set(raw.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4);
  return { width, height, rgba };
}

const files = new Map<string, Buffer>();
const put = (p: string, b: Uint8Array | Buffer | string) => files.set(p.toLowerCase().replace(/\\/g, '/'), typeof b === 'string' ? Buffer.from(b, 'latin1') : Buffer.from(b));
const norm = (p: string) => p.toLowerCase().replace(/\\/g, '/');
const vfs = { has: (p: string) => files.has(norm(p)), read: (p: string) => files.get(norm(p))!, list: () => [...files.keys()] };

type Item = ReturnType<typeof form>;
/** A slot tag as a chunk stores it: little-endian, so MAIN is written NIAM. */
const tag = (w: W, slot: string) => { for (const ch of [...slot].reverse()) w.u8(ch.charCodeAt(0)); return w; };
const txm = (slot: string, path: string): Item => form('TXM ', form('0002', chunk('DATA', tag(new W(), slot).u8(0).u8(0).u8(0).u8(0).u8(2).u8(2).u8(2).u8(0).bytes()), chunk('NAME', new W().str(path).bytes())));
const tsns = (slot: string, r: number[]): Item => form('TSNS', chunk('0000', (() => { const w = tag(new W(), slot); for (const v of r) w.f32(v); return w.bytes(); })()));
const arvs = (slot: string, ref: number): Item => form('ARVS', chunk('0000', tag(new W(), slot).u8(ref).bytes()));
const tcss = (slot: string, set: number): Item => form('TCSS', chunk('0000', tag(new W(), slot).u8(set).bytes()));

interface PassOpts { zWrite?: number; blend?: number; op?: number; src?: number; dst?: number; test?: number; ref?: string | null; zCompare?: number }
/** A pass DATA chunk laid out for its version: a pixel-shader byte first before 5, a heat byte after dither from 10. */
function passData(version: number, o: PassOpts = {}) {
  const w = new W();
  if (version <= 4) w.u8(1);
  w.i8(0).i8(1).i8(0).u8(0);
  if (version >= 10) w.u8(0);
  w.u8(1).u8(o.zWrite ?? 1).i8(o.zCompare ?? 3).u8(o.blend ?? 0).i8(o.op ?? 0).i8(o.src ?? 4).i8(o.dst ?? 5).u8(o.test ?? 0);
  if (o.ref) tag(w, o.ref); else w.u32(0);
  w.i8(7).u8(15).u32(0);
  if (version >= 7) w.u32(0);
  return w.bytes();
}
const pass = (version: number, o: PassOpts, vsh: string | null, psh: string | null, samplers: string[]): Item => {
  const kids: Item[] = [chunk('DATA', passData(version, o))];
  if (vsh) kids.push(form('PVSH', chunk('0000', new W().str(vsh).bytes())));
  if (psh) kids.push(form('PPSH', form('0001', chunk('DATA', new W().u8(1).str(psh).bytes()), ...samplers.map((t, i) => form('PTXM', chunk('0002', tag(new W().u8(i), t).bytes()))))));
  return form('PASS', form(String(version).padStart(4, '0'), ...kids));
};
const impl = (p: Item): Item => form('IMPL', form('0005', chunk('SCAP', new W().u32(0).bytes()), chunk('DATA', new W().u8(1).bytes()), p));
const efct = (...impls: Item[]): Item => form('EFCT', form('0001', chunk('DATA', new W().u8(2).u8(0).bytes()), ...impls));
const ssht = (effect: string | Item, items: Item[]) => encode(form('SSHT', form('0001', ...(typeof effect === 'string' ? [chunk('NAME', new W().str(effect).bytes())] : [effect]), ...items)));
const text = (slot: string, path: string) => chunk('TEXT', tag(new W(), slot).str(path).bytes());
const swts = (base: string, timing: Item, frames: Item[]) => encode(form('SWTS', form('0000', chunk('NAME', new W().str(base).bytes()), timing, ...frames)));
const dtst = (n: number, s: number) => form('DTST', chunk('0000', new W().i32(n).f32(s).bytes()));
const drts = (n: number, a: number, b: number) => form('DRTS', chunk('0000', new W().i32(n).f32(a).f32(b).bytes()));
const dppt = (n: number, a: number, b: number) => form('DPPT', chunk('0000', new W().i32(n).f32(a).f32(b).bytes()));
const countOnly = (type: string, n: number) => form(type, chunk('0000', new W().i32(n).bytes()));

// Programs, written for these tests in the shape the client's are (HLSL for ps2.0, assembly for ps1.1).
const VSH_SPLIT = 'out.textureCoordinateSet0 = inV.textureCoordinateSetMAIN + textureScroll.xy;\nout.textureCoordinateSet1 = inV.textureCoordinateSetMAIN + textureScroll.zw;\n';
const VSH_SCROLL = '// scroll the main set\nout.textureCoordinateSet0 = inV.textureCoordinateSetMAIN + textureScroll.xy;\n';
const VSH_PLAIN = 'out.textureCoordinateSet0 = inV.textureCoordinateSetMAIN;\n';
const VSH_OFFSET = 'out.position_o.y = textureScroll.x;\nout.position_o.z = textureScroll.y;\n';
const PSH_SPLIT = 'ps.1.1\ntex t0 // colour\ntex t1 // alpha\nmul r0.rgb, t0, v0\n+\nmul r0.a, t1.a, c[alphaFadeOpacity]\n';
const PSH_SIMPLE = 'ps.1.1\ntex t0\nmul r0.rgb, t0, v0\nmov r0.a, c[alphaFadeOpacity]\n';
const PSH_FULL = 'sampler diffuseMap : register(s0);\nfloat3 c = tex2D(diffuseMap, tcs_MAIN);\nresult.rgb = c;\nresult.a = alphaFadeOpacity;\n';
const PSH_LERP = 'sampler diffuseMap : register(s0);\nfloat emisMask;\nfloat4 sample = tex2D(diffuseMap, tcs_MAIN);\nemisMask = sample.a;\nresult.rgb = lerp(litTexture, diffuseColor, emisMask);\n';
const PSH_EMIS = 'sampler diffuseMap : register(s0);\nsampler emisMap : register(s1);\nfloat4 sample = tex2D(diffuseMap, tcs_MAIN);\nfloat emisMask = tex2D(emisMap, tcs_MAIN).a;\nfloat3 light = saturate(vertexDiffuse + emisMask);\n';
const PSH_NRML = 'sampler diffuseMap : register(s0);\nsampler normalMap : register(s1);\nfloat emisMask = tex2D(normalMap, tcs_NRML).a;\n';
const PSH_SPEC = 'sampler diffuseMap : register(s0);\nsampler emis_specMap : register(s1);\nfloat3 emisMap;\nfloat4 sample = tex2D(emis_specMap, tcs_MAIN);\nemisMap = sample.rgb;\n';
const PSH_ADD = 'sampler diffuseMap : register(s0);\nresult.rgb = tex2D(diffuseMap, tcs_MAIN) * alphaFadeOpacity;\nresult.a = 0.0f;\n';
const ASM_LRP = 'ps.1.1\ntex t0\nmul r0, t0, v0\nlrp r0.rgb, t0.a, t0, r0\n';
const ASM_LRP3 = 'ps.1.1\ntex t0\ntex t3\nmad r0, r0, t3, r1\nlrp r0.rgb, t0.a, t3, r0\n';
const ASM_PLAIN = 'ps.1.1\ntex t0\nmov r0, t0\n';
// The retail a_specmap_bump_emismap_ps20 reads one local, `sample`, in two blocks: the diffuse map (its
// alpha the specular mask), then the normal map, whose alpha is the glow mask.
const PSH_BUMP_EMIS = [
  'sampler diffuseMap : register(s0);', 'sampler normalMap : register(s1);',
  'float4 main(in float2 tcs_MAIN : TEXCOORD0, in float2 tcs_NRML : TEXCOORD1) : COLOR', '{', '\tfloat4 result;',
  '\t// fetch the diffuse texture color and specular mask', '\tfloat3 diffuseColor;', '\tfloat specularMask;',
  '\t{', '\t\tfloat4 sample = tex2D(diffuseMap, tcs_MAIN);', '\t\tdiffuseColor = sample.rgb;', '\t\tspecularMask = sample.a;', '\t}',
  '\t// fetch normal map and emis mask', '\tfloat3 normal_t;', '\tfloat emisMask;',
  '\t{', '\t\tfloat4 sample = tex2D(normalMap, tcs_NRML);', '\t\tnormal_t = signAndBias(sample.rgb);', '\t\temisMask = sample.a;', '\t}',
  '\tfloat3 allDiffuseLight = calculateHemisphericLighting(lightDirection_t, normal_t, vertexDiffuse + emisMask);',
  '\tresult.rgb = diffuseColor * allDiffuseLight;', '\treturn result;', '}', '',
].join('\n');
// The retail envmask assembly: the lit colour lerps toward the environment cube (t1 on ENVM) by a mask.
const ASM_ENVMASK = 'ps.1.1\ntex t0\ntex t1\ntex t2\nmul r0.rgb, t0, v0\nlrp r0.rgb, t2.a, t1, r0\n';
const ASM_ENVMASK_DETAIL = 'ps.1.1\ntex t0\ntex t1\ntex t2\ntex t3\nmul r0.rgb, t0, v0\n//lerp unlit envmap after diffuse lighting\nlrp r0.rgb, t0.a, t1, r0\n';
// An envmask lrp first and the glow's lrp toward MAIN after it: the glow is the one toward MAIN.
const ASM_ENV_THEN_EMIS = 'ps.1.1\ntex t0\ntex t1\ntex t2\nlrp r0.rgb, t2.a, t1, r0\nlrp r0.rgb, t0.a, t0, r0\n';
put('vertex_program/split.vsh', VSH_SPLIT);
put('vertex_program/scroll.vsh', VSH_SCROLL);
put('vertex_program/plain.vsh', VSH_PLAIN);
put('pixel_program/split.psh', PSH_SPLIT);
put('pixel_program/simple.psh', PSH_SIMPLE);
put('pixel_program/full.psh', PSH_FULL);
put('pixel_program/lerp.psh', PSH_LERP);
put('pixel_program/emis.psh', PSH_EMIS);
put('pixel_program/add.psh', PSH_ADD);
put('pixel_program/bump_emis.psh', PSH_BUMP_EMIS);
put('pixel_program/envmask.psh', ASM_ENVMASK);

// Effects.
const splitPass = (v = 9) => pass(v, { zWrite: 0, blend: 1, src: 4, dst: 5, test: 1, ref: 'MAIN' }, 'vertex_program/split.vsh', 'pixel_program/split.psh', ['MAIN', 'MAIN']);
put('effect/a_splitalpha_scroll.eft', encode(efct(impl(splitPass()))));
put('effect/a_alpha.eft', encode(efct(impl(pass(9, { zWrite: 0, blend: 1, src: 4, dst: 5, test: 1, ref: 'MAIN' }, 'vertex_program/plain.vsh', 'pixel_program/simple.psh', ['MAIN'])))));
put('effect/a_alpha_scroll.eft', encode(efct(impl(pass(9, { zWrite: 0, blend: 1, src: 4, dst: 5, test: 1, ref: 'MAIN' }, 'vertex_program/scroll.vsh', 'pixel_program/simple.psh', ['MAIN'])))));
put('effect/a_emis_full.eft', encode(efct(impl(pass(9, {}, 'vertex_program/plain.vsh', 'pixel_program/full.psh', ['MAIN'])))));
put('effect/a_alpha_emis_full.eft', encode(efct(impl(pass(9, { zWrite: 0, blend: 1, src: 4, dst: 5, test: 1, ref: 'A000' }, 'vertex_program/plain.vsh', 'pixel_program/full.psh', ['MAIN'])))));
put('effect/a_emismap.eft', encode(efct(impl(pass(9, {}, 'vertex_program/plain.vsh', 'pixel_program/lerp.psh', ['MAIN'])))));
put('effect/a_specmap_emismap_bloom.eft', encode(efct(impl(pass(9, {}, 'vertex_program/plain.vsh', 'pixel_program/emis.psh', ['MAIN', 'EMIS'])))));
put('effect/a_punchout_emismap.eft', encode(efct(impl(pass(9, { test: 1 }, 'vertex_program/plain.vsh', 'pixel_program/emis.psh', ['MAIN', 'EMIS'])))));
put('effect/a_emisadd.eft', encode(efct(impl(pass(9, { zWrite: 0, blend: 1, src: 1, dst: 1 }, 'vertex_program/plain.vsh', 'pixel_program/add.psh', ['MAIN'])))));
put('effect/e_celestial_front.eft', encode(efct(impl(pass(9, { zWrite: 0, blend: 1, src: 4, dst: 1 }, 'vertex_program/plain.vsh', 'pixel_program/simple.psh', ['MAIN'])))));
put('effect/a_simple.eft', encode(efct(impl(pass(9, {}, 'vertex_program/plain.vsh', 'pixel_program/simple.psh', ['MAIN'])))));
put('effect/a_specmap_bump_emismap.eft', encode(efct(impl(pass(9, {}, 'vertex_program/plain.vsh', 'pixel_program/bump_emis.psh', ['MAIN', 'NRML'])))));
put('effect/c_alpha_envmask.eft', encode(efct(impl(pass(9, { zWrite: 0, blend: 1, src: 4, dst: 5 }, 'vertex_program/plain.vsh', 'pixel_program/envmask.psh', ['MAIN', 'ENVM', 'MASK'])))));
// e_particle_subtract: One/One under blend operation 2 (subtract), where the additive ones use 0.
put('effect/e_particle_subtract.eft', encode(efct(impl(pass(9, { zWrite: 0, blend: 1, op: 2, src: 1, dst: 1 }, 'vertex_program/plain.vsh', 'pixel_program/simple.psh', ['MAIN'])))));

// Images: a 2x2 glow test (colour, mask) and plainer textures.
const glowTexels = [51, 51, 51, 0, 128, 128, 128, 128, 255, 255, 255, 255, 188, 188, 188, 128];
put('texture/glow.dds', dds(2, 2, glowTexels));
put('texture/emis_mask.dds', dds(2, 2, [0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 0]));
put('texture/falls.dds', dds(2, 2, [200, 210, 220, 10, 190, 200, 210, 90, 180, 190, 200, 160, 170, 180, 190, 250]));
put('texture/plain.dds', dds(2, 2, solid(4, [90, 80, 70, 255])));
// A normal map whose alpha is the glow mask (only the second texel glows), and a main whose alpha is too faint to glow.
put('texture/bump_nrml.dds', dds(2, 2, [128, 128, 255, 0, 128, 128, 255, 255, 128, 128, 255, 0, 128, 128, 255, 0]));
put('texture/env_mask.dds', dds(2, 2, solid(4, [0, 0, 0, 255])));
put('texture/faint.dds', dds(2, 2, solid(4, [120, 110, 100, 5])));
put('texture/fence.dds', dds(2, 2, [255, 0, 0, 0, 0, 255, 0, 64, 0, 0, 255, 128, 255, 255, 255, 255]));
for (let i = 1; i <= 4; i++) put(`texture/screen_0${i}.dds`, dds(2, 2, solid(4, [i * 40, i * 30, i * 20, 255])));
for (let i = 1; i <= 3; i++) put(`texture/sign_0${i}.dds`, dds(2, 2, [i * 60, 0, 0, 255, 0, i * 60, 0, 0, 0, 0, i * 60, 255, 50, 50, 50, 0]));

// Shaders.
put('shader/waterfall_scroll.sht', ssht('effect/a_splitalpha_scroll.eft', [form('TXMS', txm('MAIN', 'texture/falls.dds')), tcss('MAIN', 0), tsns('MAIN', [-0.15, -0.5, 0, -0.5]), arvs('MAIN', 6)]));
put('shader/waterfall_scroll_slow.sht', ssht('effect/a_splitalpha_scroll.eft', [form('TXMS', txm('MAIN', 'texture/falls.dds')), tsns('MAIN', [-0.13, -0.5, 0, -0.25]), arvs('MAIN', 6)]));
// The whitewater writes its effect inline, version 8.
put('shader/whitewater.sht', ssht(efct(impl(splitPass(8))), [form('TXMS', txm('MAIN', 'texture/falls.dds')), tcss('MAIN', 0), tsns('MAIN', [-0.25, -0.6, 0.6, 0]), arvs('MAIN', 6)]));
put('shader/plain_alpha.sht', ssht('effect/a_alpha.eft', [form('TXMS', txm('MAIN', 'texture/falls.dds')), arvs('MAIN', 6)]));
put('shader/defaultemis.sht', ssht('effect/a_emis_full.eft', [form('TXMS', txm('MAIN', 'texture/plain.dds'))]));
put('shader/screen_base.sht', ssht('effect/a_alpha_emis_full.eft', [form('TXMS', txm('MAIN', 'texture/plain.dds'))]));
put('shader/decal_emismap.sht', ssht('effect\\a_emismap.eft', [form('TXMS', txm('MAIN', 'texture/glow.dds'))]));
put('shader/decal_emis_slot.sht', ssht('effect\\a_specmap_emismap_bloom.eft', [form('TXMS', txm('MAIN', 'texture/glow.dds'), txm('EMIS', 'texture/emis_mask.dds'))]));
put('shader/decal_punchout.sht', ssht('effect\\a_punchout_emismap.eft', [form('TXMS', txm('MAIN', 'texture/glow.dds'), txm('EMIS', 'texture/emis_mask.dds'))]));
put('shader/fence_add.sht', ssht('effect/a_emisadd.eft', [form('TXMS', txm('MAIN', 'texture/fence.dds'))]));
put('shader/sun_glow.sht', ssht('effect/e_celestial_front.eft', [form('TXMS', txm('MAIN', 'texture/fence.dds'))]));
put('shader/plain.sht', ssht('effect/a_simple.eft', [form('TXMS', txm('MAIN', 'texture/plain.dds'))]));
put('shader/scroll_only.sht', ssht('effect/a_alpha_scroll.eft', [form('TXMS', txm('MAIN', 'texture/falls.dds')), tsns('MAIN', [0, 0.2, 0, 0])]));
put('shader/invisible.sht', ssht('effect/invisible_collidable.eft', [form('TXMS', txm('MAIN', 'texture/plain.dds'))]));
put('shader/sign_base.sht', ssht('effect/a_emismap.eft', [form('TXMS', txm('MAIN', 'texture/sign_01.dds'))]));
put('shader/engine_bump_emis.sht', ssht('effect/a_specmap_bump_emismap.eft', [form('TXMS', txm('MAIN', 'texture/glow.dds'), txm('NRML', 'texture/bump_nrml.dds'))]));
put('shader/wall_envmask.sht', ssht('effect/c_alpha_envmask.eft', [form('TXMS', txm('MAIN', 'texture/glow.dds'), txm('MASK', 'texture/env_mask.dds'))]));
put('shader/particle_subtract.sht', ssht('effect/e_particle_subtract.eft', [form('TXMS', txm('MAIN', 'texture/fence.dds'))]));
put('shader/faint_emismap.sht', ssht('effect/a_emismap.eft', [form('TXMS', txm('MAIN', 'texture/faint.dds'))]));
// Flip-books.
const screenFrames = [1, 2, 3, 4].map((i) => text('MAIN', `texture/screen_0${i}.dds`));
put('shader/anim_screen.sht', swts('shader/defaultemis.sht', dtst(4, 0.1), screenFrames));
put('shader/anim_screen_gap.sht', swts('shader/defaultemis.sht', dtst(3, 0.1), [text('MAIN', 'texture/screen_01.dds'), text('MAIN', 'texture/absent.dds'), text('MAIN', 'texture/screen_03.dds')]));
put('shader/anim_screen_mrml.sht', swts('shader/defaultemis.sht', dtst(2, 0.5), [text('MRML', 'texture/screen_01.dds'), text('MRML', 'texture/screen_02.dds')]));
put('shader/x_base.sht', ssht('effect/a_alpha_emis_full.eft', [form('TXMS', txm('MAIN', 'texture/plain.dds'))]));
put('shader/anim_exported.sht', swts('c:\\a_exported\\shader\\X_base.sht', drts(2, 1.4286, 1), [text('MAIN', 'texture/screen_01.dds'), text('MAIN', 'texture/screen_02.dds')]));
put('shader/anim_sign.sht', swts('shader/sign_base.sht', dppt(3, 0.2, 0.2), [1, 2, 3].map((i) => text('MAIN', `texture/sign_0${i}.dds`))));
put('shader/anim_fence.sht', swts('shader/fence_add.sht', dtst(2, 0.0833), [text('MAIN', 'texture/fence.dds'), text('MAIN', 'texture/screen_02.dds')]));
put('shader/frame_a.sht', ssht('effect/a_simple.eft', [form('TXMS', txm('MAIN', 'texture/screen_01.dds'))]));
put('shader/frame_b.sht', ssht('effect/a_simple.eft', [form('TXMS', txm('MAIN', 'texture/screen_02.dds'))]));
put('shader/swsh_all.sht', encode(form('SWSH', form('0000', dtst(2, 0.1), chunk('NAME', new W().str('shader/frame_a.sht').bytes()), chunk('NAME', new W().str('shader\\frame_b.sht').bytes())))));
put('shader/swsh_none.sht', encode(form('SWSH', form('0000', dtst(16, 0.1), chunk('NAME', new W().str('shader/gone_01.sht').bytes()), chunk('NAME', new W().str('shader/gone_02.sht').bytes())))));

// --- timingOf, shaderPathOf ------------------------------------------------------------------

const tf = (item: Item) => timingOf(parseIff(Buffer.from(encode(item))));
{
  const t = tf(dtst(8, 0.1));
  ok(t.mode === 'time' && t.count === 8 && near(t.seconds[0], 0.1, 1e-6) && t.seconds[0] === t.seconds[1], 'DTST [8, 0.1] is a time switcher at 0.1 s a frame');
  const r = tf(drts(6, 1, 0.05));
  ok(r.mode === 'random' && r.count === 6 && near(r.seconds[0], 0.05, 1e-6) && near(r.seconds[1], 1, 1e-6), 'DRTS [6, 1, 0.05] is random with its range sorted to [0.05, 1]');
  const p = tf(dppt(8, 0.2, 0.2));
  ok(p.mode === 'pingpong' && near(p.seconds[0], 0.2, 1e-6) && near(p.seconds[1], 0.2, 1e-6), 'DPPT [8, 0.2, 0.2] is ping-pong (the client class DeltaPingPongSwitcher)');
  const f = tf(countOnly('DFST', 6));
  const rf = tf(countOnly('DRFS', 6));
  ok(f.mode === 'frame' && rf.mode === 'randomFrame' && near(f.seconds[0], 1 / 30, 1e-9) && near(rf.seconds[1], 1 / 30, 1e-9), 'DFST and DRFS are the frame and random-frame switchers at 1/30 s');
  ok(tf(countOnly('XXXX', 3)) === null, 'an unknown timing form is null');
}
ok(shaderPathOf('c:\\a_exported\\shader\\X_base.sht') === 'shader/x_base.sht', 'an exporter path is the shader of the same name under shader/');
ok(shaderPathOf('shader\\Anim_Bank.sht') === 'shader/anim_bank.sht', 'a shader path is lower case with forward slashes');

// --- describeSurface: flip-books ---------------------------------------------------------------

{
  const d = describeSurface(vfs, 'shader/anim_screen.sht');
  ok(d.kind === 'SWTS' && d.base === 'shader/defaultemis.sht', 'an SWTS names its base shader');
  ok(d.main === 'texture/screen_01.dds' && d.anim?.frames.join() === screenFrames.map((_, i) => `texture/screen_0${i + 1}.dds`).join(), 'the main is frame 1 and the frames are in order');
  ok(d.emissive?.kind === 'full' && d.effect === 'effect/a_emis_full.eft', "the base's unlit effect comes with it");
  ok(d.anim?.mode === 'time' && near(d.anim.seconds[0], 0.1, 1e-6), 'the timing is the flip-book\'s own');
  const gap = describeSurface(vfs, 'shader/anim_screen_gap.sht');
  ok(!gap.anim && gap.main === 'texture/screen_01.dds' && gap.notes.some((n) => /1 of 3 frames missing/.test(n)) && gap.flip?.missing.join() === 'texture/absent.dds', 'a missing frame drops the animation with a note; frame 1 is still the main');
  const mrml = describeSurface(vfs, 'shader/anim_screen_mrml.sht');
  ok(!mrml.anim && mrml.main === 'texture/plain.dds' && mrml.notes.some((n) => /slot MRML/.test(n)), "frames in another slot than the base's main are not animated");
  const exp = describeSurface(vfs, 'shader/anim_exported.sht');
  ok(exp.base === 'shader/x_base.sht' && exp.effect === 'effect/a_alpha_emis_full.eft' && exp.anim?.mode === 'random' && near(exp.anim.seconds[0], 1, 1e-4) && near(exp.anim.seconds[1], 1.4286, 1e-4), 'an exporter-path base is found under shader/');
  const none = describeSurface(vfs, 'shader/swsh_none.sht');
  ok(none.kind === 'SWSH' && none.main === null && none.notes.includes('0/2 frame shaders in the archives'), 'an SWSH with no frame shader present has no main and says so');
  const all = describeSurface(vfs, 'shader/swsh_all.sht');
  ok(all.anim?.frames.join() === 'texture/screen_01.dds,texture/screen_02.dds' && all.main === 'texture/screen_01.dds', "an SWSH's frames are its frame shaders' mains");
}

// --- describeSurface: chunks, pass, programs --------------------------------------------------

{
  const d = describeSurface(vfs, 'shader/whitewater.sht');
  const r = d.records;
  ok(r.scroll.MAIN.join() === '-0.25,-0.6,0.6,0', 'TSNS gives the 20-byte record MAIN (-0.25, -0.6, 0.6, 0)');
  ok(r.alphaRefs.MAIN === 6 && r.texcoordSets.MAIN === 0, 'ARVS gives MAIN = 6 and TCSS MAIN = 0');
  ok(d.inline && d.effect === null && d.alphaRef === 6, 'an inline effect is read, and the reference is the ARVS value of the tag the pass names');
  ok(d.split && d.scroll?.map.join() === '-0.25,-0.6' && d.scroll.alpha?.join() === '0.6,0', 'the whitewater is split alpha, its colour and alpha scrolling apart');
  const plain = describeSurface(vfs, 'shader/plain_alpha.sht');
  ok(!plain.split && !plain.scroll, 'a plain alpha shader neither scrolls nor splits');
  const slow = describeSurface(vfs, 'shader/scroll_only.sht');
  ok(slow.scroll?.map.join() === '0,0.2' && slow.scroll.alpha === null && !slow.split, 'a_scroll moves set 0 only');
}
{
  const inline = passState(parseIff(Buffer.from(encode(efct(impl(splitPass(8)))))));
  ok(inline.version === 8 && !inline.zWrite && inline.alphaBlend && inline.blendSrc === 4 && inline.blendDst === 5 && inline.alphaTest && inline.alphaRefTag === 'MAIN', 'a version 8 pass: no z-write, blend 4/5, test on, reference tag MAIN');
  ok(inline.vertexProgram === 'vertex_program/split.vsh' && inline.pixelProgram === 'pixel_program/split.psh' && inline.samplers[0] === 'MAIN' && inline.samplers[1] === 'MAIN', 'the pass names its programs and its samplers');
  // An opaque bump pass of version 10: the heat byte moves every field one on.
  const bytes = passData(10, { zWrite: 1, blend: 0, src: 4, dst: 5, test: 0 });
  const heat = parseIff(Buffer.from(encode(efct(impl(pass(10, { zWrite: 1, blend: 0, src: 4, dst: 5, test: 0 }, null, null, []))))));
  const st = passState(heat);
  ok(bytes[7] !== 0 && bytes[11] !== 0, 'at the fixed offsets 7 and 11 a version 10 opaque pass reads z-compare and the blend destination (the old MASK)');
  ok(!st.alphaBlend && !st.alphaTest && st.zWrite && alphaModeFor(effectAlpha(heat)) === 'OPAQUE', 'read at its own offsets it neither blends nor tests, and effectAlpha says OPAQUE');
  const v4 = passState(parseIff(Buffer.from(encode(efct(impl(pass(4, { zWrite: 0, blend: 1, src: 4, dst: 5, test: 1 }, null, null, [])))))));
  ok(v4.alphaBlend && v4.alphaTest && !v4.zWrite && v4.blendDst === 5, 'a version 4 pass starts with a pixel-shader byte');
  const one = passState(parseIff(files.get('effect/a_emisadd.eft')!));
  ok(one.additive && one.blendSrc === 1, 'a 1/1 pass is additive');
  const src4 = passState(parseIff(files.get('effect/e_celestial_front.eft')!));
  ok(src4.additive && src4.blendSrc === 4, 'a 4/1 pass is additive with source SrcAlpha');
  const sub = passState(parseIff(files.get('effect/e_particle_subtract.eft')!));
  ok(sub.alphaBlend && sub.blendDst === 1 && sub.blendOp === 2 && !sub.additive, 'a 1/1 pass under blend operation 2 (subtract) is not additive');
  // Any implementation's first pass counts for effectAlpha; the first implementation's for the rest.
  const two = parseIff(Buffer.from(encode(efct(impl(pass(9, {}, null, null, [])), impl(pass(9, { test: 1 }, null, null, []))))));
  ok(!passState(two).alphaTest && passState(two).anyTest && effectAlpha(two).alphaTest, 'the first implementation decides the pass; any implementation that tests still makes effectAlpha test');
}
{
  const a = scrollSets(VSH_SPLIT);
  const b = scrollSets(VSH_SCROLL);
  ok(a.set0 === 'xy' && a.set1 === 'zw', 'a_scroll_rgb1_a2 moves set 0 by .xy and set 1 by .zw');
  ok(b.set0 === 'xy' && b.set1 === null, 'a_scroll moves set 0 only');
  const c = scrollSets(VSH_OFFSET);
  ok(c.set0 === null && c.set1 === null && scrollSets(VSH_PLAIN).set0 === null, 'a program that moves positions by textureScroll, or none at all, scrolls no texture');
  ok(isSplitAlpha('pixel_program/split.psh', PSH_SPLIT, { 0: 'MAIN', 1: 'MAIN' }), 'the split-alpha program with both samplers on MAIN is split');
  ok(!isSplitAlpha('pixel_program/full.psh', PSH_FULL, { 0: 'MAIN' }) && !isSplitAlpha('x', PSH_SPLIT, { 0: 'MAIN', 1: 'NRML' }), 'the unlit program is not split, nor is t0/t1 on different tags');
}
{
  const e = (name: string, t: string, s: Record<number, string>) => emissiveOf(name, t, s);
  const str = (m: any) => (m ? (m.kind === 'mask' ? `mask ${m.slot} ${m.channel}` : m.kind) : 'null');
  ok(str(e('effect/a_emis_full.eft', PSH_FULL, { 0: 'MAIN' })) === 'full', 'a_emis_full is unlit');
  ok(str(e('effect\\a_emismap.eft', PSH_LERP, { 0: 'MAIN' })) === 'mask MAIN a', 'the lerp family glows by MAIN.a (read through the local it sampled)');
  ok(str(e('effect\\a_specmap_emismap_bloom.eft', PSH_EMIS, { 0: 'MAIN', 1: 'EMIS' })) === 'mask EMIS a', 'the emisMap family glows by EMIS.a (the sampler register gives the tag)');
  ok(str(e('effect\\a_specmap_bump_emismap_vcolor.eft', PSH_NRML, { 0: 'MAIN', 1: 'NRML' })) === 'mask NRML a', 'the vcolor bump family glows by NRML.a');
  ok(str(e('effect\\a_specmap_aniso_emismap.eft', PSH_SPEC, { 0: 'MAIN', 1: 'SPEC' })) === 'mask SPEC rgb', 'the aniso family glows by SPEC.rgb');
  ok(str(e('effect\\a_emisadd.eft', PSH_ADD, { 0: 'MAIN' })) === 'add' && str(e('', PSH_ADD, { 0: 'MAIN' })) === 'add', 'emisadd is additive, by name or by its program');
  ok(str(e('effect\\c_emismap.eft', ASM_LRP, { 0: 'MAIN' })) === 'mask MAIN a', "assembly's lrp rN.rgb, t0.a names sampler 0's tag");
  ok(str(e('effect\\c_specmap_bump_emismap.eft', ASM_LRP3, { 0: 'NRML', 2: 'LKUP', 3: 'MAIN' })) === 'mask NRML a', 'an lrp by t0.a with sampler 0 on NRML glows by NRML.a');
  ok(str(e('effect/dot3_terrain_emismap.eft', ASM_PLAIN, { 0: 'MAIN' })) === 'mask MAIN a', 'assembly without lrp falls back on the name');
  ok(str(e('effect/a_simple.eft', PSH_SIMPLE, { 0: 'MAIN' })) === 'null', 'a lit effect does not glow');
  ok(str(e('effect\\a_specmap_bump_emismap.eft', PSH_BUMP_EMIS, { 0: 'MAIN', 1: 'NRML' })) === 'mask NRML a', 'a local read in two blocks: the mask is the read nearest before the assignment (the normal map), not the first (the diffuse map)');
  ok(str(e('effect/c_alpha_envmask.eft', ASM_ENVMASK, { 0: 'MAIN', 1: 'ENVM', 2: 'MASK' })) === 'null', 'an lrp toward the environment cube (t1 on ENVM) by MASK.a is an environment mask, not a glow');
  ok(str(e('effect/c_envmask_specmap_detail.eft', ASM_ENVMASK_DETAIL, { 0: 'MAIN', 1: 'ENVM', 2: 'SPEC', 3: 'DETA' })) === 'null', 'an lrp toward ENVM by MAIN.a is not a glow either');
  ok(str(e('effect/c_envmask_specmap_detail_emismap.eft', ASM_ENV_THEN_EMIS, { 0: 'MAIN', 1: 'ENVM', 2: 'SPEC' })) === 'mask MAIN a', 'with an envmask lrp first, the glow is the first lrp toward MAIN');
}

// --- images ----------------------------------------------------------------------------------

const dec = (b: number) => { const c = b / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const enc = (l: number) => Math.round((l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055) * 255);
{
  const img = { width: 2, height: 2, rgba: Uint8Array.from(glowTexels) };
  ok(rgbOnly(img).rgba.every((v, i) => (i % 4 === 3 ? v === 255 : v === glowTexels[i])), 'rgbOnly keeps the colour and makes alpha 255');
  ok(alphaAsGrey(img).rgba.every((v, i) => (i % 4 === 3 ? v === 255 : v === glowTexels[i - (i % 4) + 3])), 'alphaAsGrey puts the alpha in red, green and blue');
  ok(maskOf(img, { width: 2, height: 2, rgba: new Uint8Array(16) }, 'a') === null, 'an empty mask is null');
  const m = maskOf(img, img, 'a')!;
  const { lit, emis } = splitGlow(img, m, false);
  let sumOk = true;
  for (let i = 0; i < 4; i++) for (let c = 0; c < 3; c++) if (Math.abs(enc(dec(lit.rgba[i * 4 + c]) + dec(emis.rgba[i * 4 + c])) - glowTexels[i * 4 + c]) > 1) sumOk = false;
  ok(sumOk, 'lit + glow, added in linear light, is the texture within one step');
  ok(near(emis.rgba[12], enc(dec(188) * (128 / 255)), 0) && near(emis.rgba[12], 137, 1), `the glow at m = 0.5 on sRGB 188 is about 137 (${emis.rgba[12]}), not the 94 of multiplying the bytes`);
  ok(lit.rgba[8] === 0 && lit.rgba[9] === 0 && emis.rgba[8] === 255, 'at m = 1 the lit image is black and the glow is the texture');
  ok(emis.rgba[0] === 0 && lit.rgba[0] === 51, 'at m = 0 the glow is black and the lit image is the texture');
  ok(lit.rgba[7] === 255 && splitGlow(img, m, true).lit.rgba[7] === 128, 'the lit alpha is 255, or the source alpha when kept');
  const big = { width: 1024, height: 256, rgba: new Uint8Array(1024 * 256 * 4).fill(200) };
  const fit = fitRgba(big, 512);
  ok(fit.width === 512 && fit.height === 128 && fit.rgba[0] === 200, 'fitRgba halves a 1024 x 256 image to 512 x 128');
  ok(maskOf(img, { width: 1, height: 1, rgba: Uint8Array.from([10, 200, 30, 0]) }, 'rgb')![3] === Math.fround(200 / 255),'an rgb mask is the largest channel, sampled nearest at the image size');
}

// --- the decision --------------------------------------------------------------------------------

const calls: any[] = [];
const alphaCache = new Map<string, string>();
const makeDeps = (extra: Record<string, any> = {}) => ({
  cache: new Map(),
  decodeDds,
  encodePng,
  alphaFromEffect: (effect: string | null, fallback: string) => {
    if (!effect) return fallback;
    if (!alphaCache.has(effect)) alphaCache.set(effect, vfs.has(effect) ? alphaModeFor(effectAlpha(parseIff(vfs.read(effect))), effect) : fallback);
    return alphaCache.get(effect)!;
  },
  surfaceFor: (effect: string | null, slots: any, img: any, alphaMode: string, opts: any) => { calls.push({ effect, alphaMode, opts }); return {}; },
  normalFor: () => null,
  glassNamed: /glass|window/i,
  byName: effectAlphaMode,
  log: () => {},
  ...extra,
});
const deps = makeDeps();
const T = (shader: string, d: any = deps) => surfaceTexture(vfs, shader, d);

{
  const w = T('shader/waterfall_scroll.sht');
  const src = decodeDds(files.get('texture/falls.dds')!);
  ok(w.translucent === true && w.alphaMode === 'MASK', 'a split-alpha scroll shader is translucent, and alphaMode is still MASK');
  ok(w.alphaTest === Math.round((6 / 255) * 1e4) / 1e4 && w.noShadow === true, 'its alpha test is ARVS 6 / 255 and it casts no shadow');
  const rgb = readPng(w.rgb.png);
  const alpha = readPng(w.alphaImage.png);
  ok(w.rgb.path === 'texture/falls.dds#rgb' && rgb.rgba.every((v, i) => (i % 4 === 3 ? v === 255 : v === src.rgba[i])), 'its colour image is opaque');
  ok(w.alphaImage.path === 'texture/falls.dds#alpha' && [0, 1, 2, 3].every((i) => alpha.rgba[i * 4 + 1] === src.rgba[i * 4 + 3]), "its alpha image's green is the source alpha");
  ok(w.scroll.map.join() === '-0.15,-0.5' && w.scroll.alpha.join() === '0,-0.5', 'it carries both scroll rates');
  const p = T('shader/plain_alpha.sht');
  ok(!p.translucent && p.alphaMode === 'MASK' && !p.noShadow && !p.alphaTest, 'the same pass on a plain shader stays a MASK cut-out (the 2,113 are untouched)');
  const ww = T('shader/whitewater.sht');
  ok(ww.translucent && ww.alphaMode === 'MASK' && ww.scroll.alpha.join() === '0.6,0', 'the inline whitewater is translucent and its alpha scrolls sideways');
  const add = T('shader/fence_add.sht');
  const fenceAlpha = alphaModeFor(effectAlpha(parseIff(files.get('effect/a_emisadd.eft')!)), 'effect/a_emisadd.eft');
  ok(add.blend === 'add' && add.unlit && add.alphaMode === fenceAlpha && add.noShadow, 'a 1/1 pass is additive and unlit, alphaMode unchanged');
  ok(add.rgb && readPng(add.rgb.png).rgba.every((v, i) => i % 4 !== 3 || v === 255), 'its colour is written opaque, so SrcAlpha/One adds all of it');
  const sun = T('shader/sun_glow.sht');
  ok(sun.blend === 'add' && !sun.rgb && sun.alphaMode === 'BLEND', "a 4/1 pass is additive with no opaque copy: the texture's alpha is kept, and alphaMode is the effect's");
  const screen = T('shader/screen_base.sht');
  ok(screen.unlit && screen.translucent && screen.alphaTest === undefined && !screen.lit && screen.alphaMode === 'MASK', 'an unlit alpha screen is translucent and unlit; its pass names a tag with no ARVS entry, so no alpha test');
  ok(T('shader/invisible.sht').invisible === true, 'an invisible effect is drawn as nothing, as before');
}
{
  calls.length = 0;
  const g = T('shader/decal_emismap.sht');
  const lit = readPng(g.lit.png);
  const emis = readPng(g.emissive.png);
  let sumOk = true;
  for (let i = 0; i < 4; i++) for (let c = 0; c < 3; c++) if (Math.abs(enc(dec(lit.rgba[i * 4 + c]) + dec(emis.rgba[i * 4 + c])) - glowTexels[i * 4 + c]) > 1) sumOk = false;
  ok(sumOk, 'the emismap entry: lit + glow in linear light is the texture (the lerp at full light)');
  ok(near(emis.rgba[12], 137, 1) && lit.rgba[8] === 0 && emis.rgba[0] === 0 && lit.rgba[0] === 51, 'its glow is rgb x m in linear light: black at m = 0, the whole texture at m = 1');
  ok(calls.some((c) => c.effect === 'effect/a_emismap.eft' && c.opts?.alphaIsEmissive === true) && lit.rgba[3] === 255 && lit.rgba[7] === 255, 'surfaceFor is told the alpha is the glow, and the lit alpha is 255');
  ok(g.lit.path === 'texture/glow.dds#lit:texture/glow.dds:a' && g.emissive.path === 'texture/glow.dds#emis:texture/glow.dds:a', 'the images are named for the main and the mask');
  const e = T('shader/decal_emis_slot.sht');
  ok(e.emissive.path !== g.emissive.path && e.lit.path !== g.lit.path && e.emissive.path === 'texture/glow.dds#emis:texture/emis_mask.dds:a', 'two shaders on one main with masks from different places never share an image');
  ok(readPng(e.lit.png).rgba[7] === 128 && calls.some((c) => c.effect === 'effect/a_specmap_emismap_bloom.eft' && c.opts?.alphaIsEmissive === false), 'with an EMIS mask the alpha is not the glow: surfaceFor may read it and the lit image keeps it');
  const pu = T('shader/decal_punchout.sht');
  const puLit = readPng(pu.lit.png);
  ok(pu.alphaMode === 'MASK' && [0, 1, 2, 3].every((i) => puLit.rgba[i * 4 + 3] === glowTexels[i * 4 + 3]), 'a punch-out with an EMIS glow keeps the source alpha (its cut-out) in the lit image');
  // The bump emismap glows by the normal map's alpha; the main's alpha stays its specular mask.
  calls.length = 0;
  const eng = T('shader/engine_bump_emis.sht');
  const engLit = readPng(eng.lit.png);
  const engEmis = readPng(eng.emissive.png);
  ok(eng.emissive.path === 'texture/glow.dds#emis:texture/bump_nrml.dds:a' && eng.lit.path === 'texture/glow.dds#lit:texture/bump_nrml.dds:a', "a_specmap_bump_emismap's images are named for the normal map's alpha");
  ok(engEmis.rgba[0] === 0 && engEmis.rgba[4] === 128 && engLit.rgba[4] === 0 && engLit.rgba[0] === 51, 'only the texel the normal map masks glows, whatever the main alpha says');
  ok(engLit.rgba[7] === 128 && calls.some((c) => c.effect === 'effect/a_specmap_bump_emismap.eft' && c.opts?.alphaIsEmissive === false), 'the main alpha is kept and surfaceFor may read it as the gloss mask');
  // An envmask surface is lit as before: no glow images, and its alpha is not a glow.
  calls.length = 0;
  const wall = T('shader/wall_envmask.sht');
  ok(!wall.lit && !wall.emissive && !wall.unlit && calls.some((c) => c.effect === 'effect/c_alpha_envmask.eft' && c.opts?.alphaIsEmissive === false), 'an envmask surface does not glow');
  // A mask too faint to glow splits nothing, so surfaceFor is not told the alpha is a glow.
  calls.length = 0;
  const faint = T('shader/faint_emismap.sht');
  ok(!faint.lit && !faint.emissive && calls.some((c) => c.effect === 'effect/a_emismap.eft' && c.opts?.alphaIsEmissive === false), 'an emismap whose mask is under 8/255 is neither split nor told its alpha is a glow');
  const sub = T('shader/particle_subtract.sht');
  ok(!sub.blend && !sub.unlit && !sub.rgb, 'a subtractive pass is not written additive');
}
{
  const s = T('shader/anim_screen.sht');
  ok(s.unlit && s.anim?.frames.length === 4 && s.anim.mode === 'time' && s.path === 'texture/screen_01.dds', 'an unlit flip-book: frame 1 is the main and the four frames are listed');
  ok(s.anim.frames[0].png === s.png && s.anim.frames.map((f: any) => f.path).join() === [1, 2, 3, 4].map((i) => `texture/screen_0${i}.dds`).join(), 'frame 0 reuses the main and the frames keep their order');
  const gap = T('shader/anim_screen_gap.sht');
  ok(gap && !gap.anim && gap.path === 'texture/screen_01.dds', 'a flip-book with a missing frame draws its first frame');
  const sign = T('shader/anim_sign.sht');
  ok(sign.anim?.mode === 'pingpong' && sign.anim.frames.every((f: any) => f.lit && f.emissive) && sign.hasAlpha, 'a glowing flip-book splits every frame by its own alpha, and has alpha when any frame does');
  ok(sign.anim.frames[2].emissive.path === 'texture/sign_03.dds#emis:texture/sign_03.dds:a', "a frame's glow is named for the frame");
  const fence = T('shader/anim_fence.sht');
  ok(fence.blend === 'add' && fence.anim.frames.every((f: any) => f.rgb), 'an additive flip-book writes every frame opaque');
  const tr = T('shader/anim_exported.sht');
  ok(tr.translucent && tr.unlit && tr.noShadow, 'an unlit alpha screen that flips is translucent');
}
{
  // R1: the thumbnail hook sees the texture as the game shows it, before the glow split.
  let seen: any = null;
  const withThumb = makeDeps({ thumb: (w: number, h: number, rgba: Uint8Array) => { seen = { w, h, rgba }; return { width: 1, height: 1, rgba: Uint8Array.of(1, 2, 3, 4) }; } });
  const t = T('shader/decal_emismap.sht', withThumb);
  ok(!!t.thumb && Object.getOwnPropertyDescriptor(t, 'thumb')!.enumerable === false && !JSON.stringify(t).includes('thumb') && !Object.keys(t).includes('thumb'), 'with deps.thumb the entry carries a non-enumerable thumb that JSON never shows');
  ok(seen.w === 2 && seen.h === 2 && [...seen.rgba].join() === glowTexels.join(), 'the thumbnail is made from the unsplit main image');
  const flip = T('shader/anim_screen.sht', withThumb);
  ok(!!flip.thumb && flip.anim.frames.every((f: any) => !('thumb' in f)), "a flip-book's frames get none");
  ok(T('shader/decal_emismap.sht').thumb === undefined, 'without the hook there is no thumb');
}
{
  const c = surfaceCounts([T('shader/anim_screen.sht'), T('shader/waterfall_scroll.sht'), T('shader/fence_add.sht'), T('shader/decal_emismap.sht'), T('shader/anim_sign.sht'), null]);
  ok(c.flipBooks === 2 && c.scrolling === 1 && c.unlit === 1 && c.additive === 1 && c.glowing === 2 && c.glowBytes > 0, 'surfaceCounts counts flip-books, scrolls, unlit, additive and glowing entries');
  ok(/^surfaces: 2 flip-books, 1 scrolling, 1 unlit, 1 additive, 2 glowing \(\d+\.\d MB of glow images\)$/.test(surfaceCountsLine(c)), 'and the snapshot line reads as designed');
  const line = surfaceLine(T('shader/whitewater.sht'), describeSurface(vfs, 'shader/whitewater.sht'));
  ok(line === 'translucent, alpha test 6/255, no depth write, no shadow; scrolls colour (-0.25,-0.6)/s, alpha (0.6,0)/s, split alpha', `the materials line for the whitewater (${line})`);
  ok(surfaceLine(T('shader/anim_screen.sht'), describeSurface(vfs, 'shader/anim_screen.sht')) === 'flip-book 4 frames, 0.1 s each; unlit', 'the materials line for an unlit flip-book');
  ok(surfaceLine(T('shader/decal_emismap.sht'), describeSurface(vfs, 'shader/decal_emismap.sht')) === 'glows by MAIN.a (lit and glow images)', 'the materials line for a glowing decal');
  ok(describeLines(describeSurface(vfs, 'shader/anim_screen_gap.sht')).some((l) => /missing texture\/absent\.dds/.test(l)), 'the shader command lists the missing frames');
  ok(MATERIAL_FORMAT === 2, 'the material format is 2');
  // eff.mjs imports surface.mjs; surface.mjs must not import eff.mjs back (a cycle breaks the first
  // time either module reads the other's binding while it evaluates).
  const surfaceSource = readFileSync(new URL('../surface.mjs', import.meta.url), 'utf8');
  ok(alphaModeFor === surfaceAlphaModeFor && !/from\s+['"]\.\/eff\.mjs['"]/.test(surfaceSource), "eff.mjs re-exports surface.mjs's alphaModeFor, and surface.mjs does not import eff.mjs");
}

// --- buildGlb ------------------------------------------------------------------------------------

const tri = () => ({ positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0), normals: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1), uvs: Float32Array.of(0, 0, 1, 0, 0, 1), indices: Uint16Array.of(0, 1, 2) });
const glbJson = (glb: Buffer) => JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12)));
const modelOf = (shaders: string[]) => {
  const textures = new Map(shaders.map((s) => [s, T(s)]));
  return glbJson(buildGlb([{ name: 'm', groups: shaders.map((shader) => ({ shader, primitives: [tri()] })) }], { textures }));
};
{
  const j = modelOf(['shader/anim_screen.sht', 'shader/waterfall_scroll.sht', 'shader/waterfall_scroll_slow.sht', 'shader/decal_emismap.sht', 'shader/whitewater.sht', 'shader/anim_sign.sht', 'shader/fence_add.sht']);
  const mat = (name: string) => j.materials.find((m: any) => m.name === name);
  const imageOf = (texIndex: number) => j.images[j.textures[texIndex].source].name;
  ok(j.extensionsUsed?.includes('KHR_materials_unlit') && mat('shader/anim_screen.sht').extensions?.KHR_materials_unlit && mat('shader/anim_screen.sht').extras.unlit === true, 'an unlit screen uses KHR_materials_unlit, listed in extensionsUsed, with extras.unlit');
  const screen = mat('shader/anim_screen.sht');
  ok(screen.extras.swg.anim.map.map(imageOf).join() === [1, 2, 3, 4].map((i) => `texture/screen_0${i}.dds`).join() && screen.extras.swg.anim.map[0] === screen.pbrMetallicRoughness.baseColorTexture.index, "extras.swg.anim.map indexes the frames' images in order, map[0] being the base colour");
  ok(screen.extras.swg.anim.mode === 'time' && screen.extras.swg.anim.seconds.join() === '0.1,0.1' && screen.extras.swg.anim.emissive === undefined, 'the flip-book carries its mode and seconds, and no emissive list when it does not glow');
  const a = mat('shader/waterfall_scroll.sht');
  const b = mat('shader/waterfall_scroll_slow.sht');
  const ta = j.textures[a.pbrMetallicRoughness.baseColorTexture.index];
  const tb = j.textures[b.pbrMetallicRoughness.baseColorTexture.index];
  ok(a.pbrMetallicRoughness.baseColorTexture.index !== b.pbrMetallicRoughness.baseColorTexture.index && ta.sampler !== tb.sampler && ta.source === tb.source, 'two scrolling materials on one image get their own textures and samplers over one shared image');
  ok(imageOf(a.pbrMetallicRoughness.baseColorTexture.index) === 'texture/falls.dds#rgb' && imageOf(a.extras.swg.alphaMap) === 'texture/falls.dds#alpha', "a split surface's base colour is #rgb and its alphaMap #alpha");
  ok(j.textures[a.extras.swg.alphaMap].sampler !== 0 && a.extras.swg.scroll.map.join() === '-0.15,-0.5' && a.extras.swg.scroll.alpha.join() === '0,-0.5', 'a scrolling alpha map has its own sampler too, and the rates are written');
  ok(a.alphaMode === 'BLEND' && a.doubleSided === true && a.extras.noShadow === true && a.extras.swg.alphaTest === 0.0235, 'a translucent entry whose alphaMode is MASK is written BLEND, with no shadow and its alpha test');
  const g = mat('shader/decal_emismap.sht');
  ok(g.emissiveFactor.join() === '1,1,1' && imageOf(g.emissiveTexture.index).includes('#emis:') && imageOf(g.pbrMetallicRoughness.baseColorTexture.index).includes('#lit:'), "a glowing decal's base colour is the #lit image and its emissive the #emis one");
  const s = mat('shader/anim_sign.sht');
  ok(s.extras.swg.anim.emissive.length === 3 && s.extras.swg.anim.emissive[0] === s.emissiveTexture.index && imageOf(s.extras.swg.anim.emissive[2]) === 'texture/sign_03.dds#emis:texture/sign_03.dds:a', 'a glowing flip-book lists its glow frames, the first being the emissive map');
  ok(imageOf(s.extras.swg.anim.map[1]).startsWith('texture/sign_02.dds#lit:'), "a glowing flip-book's frames are their lit images");
  const f = mat('shader/fence_add.sht');
  ok(f.extras.swg.blend === 'add' && f.alphaMode === 'BLEND' && f.extras.unlit === true, 'an additive surface is BLEND with extras.swg.blend "add"');
  // Three split surfaces (two falls and the whitewater), each with a scrolling colour and alpha.
  ok(j.samplers.length === 1 + 3 * 2 &&j.samplers.every((x: any) => x.magFilter === 9729 && x.minFilter === 9987 && x.wrapS === 10497), 'one shared sampler plus a copy per scrolling texture, all alike');
}
{
  const j = modelOf(['shader/plain.sht', 'shader/plain_alpha.sht']);
  ok(j.samplers.length === 1 && j.extensionsUsed === undefined && j.materials.every((m: any) => !m.extras?.swg && !m.extensions), 'a model with none of the new fields has one sampler, no extensionsUsed and no extras.swg');
  ok(j.materials.find((m: any) => m.name === 'shader/plain_alpha.sht').alphaMode === 'MASK' && j.materials.find((m: any) => m.name === 'shader/plain_alpha.sht').alphaCutoff === 0.5, 'a plain cut-out is written as before');
  ok(j.textures.length === j.images.length && j.textures.every((t: any, i: number) => t.source === i && t.sampler === 0), 'one texture per image on sampler 0, as before');
}

console.log(`${passed} checks passed`);
