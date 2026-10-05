// The shine, read off each shader's own pixel program (material format 6).
//
// What a surface's highlight is multiplied by is in its program: SPEC's alpha (not its luminance, which is
// what was read), the colour texture's alpha, the normal map's alpha on the whole two-tone cloth family
// (whose colour alpha is the hue mask), MASK's red, or nothing at all. The converter now writes that mask
// into the metal-rough image's red, and every textured material says what highlight the client drew
// (`extras.swgSpec`: the MATL's specular colour and power, and a band where the program bends it into one)
// and whether its shader reflects (`extras.swgCube`). Every check below is of what the model file holds:
//
//   1. `specMaskOf` on the programs' own shapes, HLSL and assembly
//   2. `materialOf` on a MATL written by hand, and two shaders on one colour texture carrying two images
//   3. with the client's archives (SWG): at least 300 shaders the packs use, over every class of mask,
//      through the converter's own readers and GLB writer, the written red decoded and set against the
//      channel the program reads (correlation at least 0.99); `none` writes no mask and `unmasked` all 255;
//      the shaders whose highlight a later pass of the program draws (the long hair, the glass) and the
//      ones whose mask counts twice among them, each against the pass that draws it and the square of its
//      mask; the two-tone cloth's red follows the normal map's alpha and not the hue mask; the MATL's floats
//      and the program's band in `extras.swgSpec`; `extras.swgCube` on the shaders with a cube and off the
//      rest, wherever their effect's own stages read none
//   4. with packs converted at format 6 (SWG3JS_PACKS, else assets-private): the models on disk themselves
//
// Run: node tools/swg/tests/specMask.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeDds } from '../dds.mjs';
import { buildGlb, glbSpecStamped } from '../glb.mjs';
import { readGlb } from '../glbclips.mjs';
import { findAll, parseIff } from '../iff.mjs';
import { encodePng } from '../png.mjs';
import { MATERIAL_FORMAT, describeSurface, materialOf, programSource, roughnessOfMask, specMaskOf } from '../surface.mjs';
import { chunk, encode, form, W } from './iffWriter.ts';
import { PACKS, converterDeps, entryOf, glbImage, glbsUnder, mountRetail, packFormat, usedShaders, writtenModel, type Img } from './materialsHarness.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const note = (s: string) => console.log(`note ${s}`);

// ---------------------------------------------------------------- 1. the programs

const HLSL = (body: string, samplers: string[]) => `//hlsl ps_2_0\n#include "pixel_program/include/functions.inc"\n${samplers.map((s, i) => `sampler ${s} : register(s${i});`).join('\n')}\nfloat4 main() : COLOR\n{\n${body}\n}\n`;
{
  const specmap = HLSL('float3 diffuseColor = tex2D(diffuseMap, tcs_MAIN);\nfloat specularMask = tex2D(specularMap, tcs_MAIN).a;\nfloat3 allSpecularLightRaw = (dot3SpecularIntensity * dot3LightSpecularColor * materialSpecularColor + vertexSpecular) * specularMask;\nfloat3 allSpecularLight = allSpecularLightRaw;\nresult.rgb = (diffuseColor * allDiffuseLight) + allSpecularLight;', ['diffuseMap', 'specularMap']);
  const sm = specMaskOf(specmap, { 0: 'MAIN', 1: 'SPEC' });
  ok(sm?.kind === 'mask' && sm.slot === 'SPEC' && sm.channel === 'a' && !sm.squared && !sm.aniso, "a specmap program's mask is its specular texture's alpha, read straight off its sampler");
  // The two-tone cloth: one local read twice, the colour (whose alpha is the hue mask) and then the normal map.
  const cloth = HLSL('float3 diffuseColor;\nfloat hueMask;\n{\n\tfloat4 sample = tex2D(diffuseMap, tcs_MAIN);\n\tdiffuseColor = sample.rgb;\n\thueMask = sample.a;\n}\nfloat3 normal_t;\nfloat specularMask;\n{\n\tfloat4 sample = tex2D(normalMap, tcs_NRML);\n\tnormal_t = signAndBias(sample.rgb);\n\tspecularMask = sample.a;\n}\nfloat3 allSpecularLightRaw = (dot3SpecularIntensity * dot3LightSpecularColor * materialSpecularColor + vertexSpecular) * specularMask;\nfloat3 allSpecularLight = allSpecularLightRaw;', ['diffuseMap', 'normalMap']);
  const c = specMaskOf(cloth, { 0: 'MAIN', 1: 'NRML' });
  ok(c?.kind === 'mask' && c.slot === 'NRML' && c.channel === 'a', "the two-tone cloth's mask is the normal map's alpha, not the hue mask the colour's alpha holds");
  const mask = HLSL('float specularMask;\n{\n\tfloat4 sample = tex2D(specular_envMap, tcs_MAIN);\n\tspecularMask = sample.rgb;\n\tenvMask = sample.a;\n}\nfloat3 allSpecularLight = allSpecularLightRaw * specularMask;', ['diffuseMap', 'specular_envMap', 'envMap']);
  const m = specMaskOf(mask, { 0: 'MAIN', 1: 'MASK', 2: 'ENVM' });
  ok(m?.kind === 'mask' && m.slot === 'MASK' && m.channel === 'r', 'a float set from .rgb keeps the first component: the mask slot read in red');
  const plain = HLSL('float3 allSpecularLightRaw = dot3SpecularIntensity * dot3LightSpecularColor * materialSpecularColor + vertexSpecular;\nresult.rgb = diffuseTexture * allDiffuseLight + allSpecularLight;', ['diffuseMap']);
  ok(specMaskOf(plain, { 0: 'MAIN' })?.kind === 'unmasked', 'a specular with nothing over it is unmasked: a mask of one');
  const none = HLSL('float3 diffuseColor = tex2D(diffuseMap, tcs_MAIN);\nresult.rgb = diffuseColor * light;', ['diffuseMap']);
  ok(specMaskOf(none, { 0: 'MAIN' })?.kind === 'none', 'a program with no specular term has none');
  // Masked inside the specular and again where it is added: the mask counts twice.
  const twice = HLSL('float specularMask = tex2D(specularMap, tcs_MAIN).a;\nfloat3 allSpecularLightRaw = (dot3SpecularIntensity * dot3LightSpecularColor * materialSpecularColor + vertexSpecular) * specularMask;\nfloat3 allSpecularLight = allSpecularLightRaw;\nresult.rgb = (diffuseColor * allDiffuseLight * hue_MAIN * hue_HUEB) + (allSpecularLight* specularMask);', ['diffuseMap', 'hueMap', 'specularMap']);
  ok(specMaskOf(twice, { 0: 'MAIN', 1: 'HUEB', 2: 'SPEC' })?.squared === true, 'a mask multiplied in twice is squared');
  // The ps 1.1 band: the mask goes on once, where the specular is added, and nowhere before.
  const once = HLSL('float specularMask = tex2D(specularMap, tcs_SPEC).a;\nfloat3 allSpecularLight = (specularLightLookup * dot3LightSpecularColor * materialSpecularColor) + specularLight;\nresult.rgb = (diffuseColor * diffuseLight) + (allSpecularLight * specularMask);', ['diffuseMap', 'specularMap', 'lightLookupTable']);
  ok(specMaskOf(once, { 0: 'MAIN', 1: 'SPEC', 2: 'LKUP' })?.squared === false, 'and one put on only where the specular is added is not');
  const band = HLSL('float specularMask = tex2D(specularMap, tcs_MAIN).a;\nfloat specularIntensity  = calculateFakeAnisotropicSpecularLighting(dot3SpecularNoPower);\nfloat3 allSpecularLightRaw = specularIntensity * dot3LightSpecularColor * materialSpecularColor * specularMask;', ['diffuseMap', 'specularMap']);
  ok(specMaskOf(band, { 0: 'MAIN', 1: 'SPEC' })?.aniso === true && specMaskOf(specmap, { 0: 'MAIN', 1: 'SPEC' })?.aniso === false, "the client's band function makes it the band; without it, the plain highlight");
  // Assembly: the vertex specular (v1) and the specular constants followed to the texture they meet.
  const smap = 'ps.1.1\ntex t0   // sample diffuse texture map\ntex t1   // sample specular map\nmul r0, v1, t1.a\nmad r0.rgb, t0, v0, r0\n+\nmov r0.a, c[alphaFadeOpacity]\n';
  ok(specMaskOf(smap, { 0: 'MAIN', 1: 'SPEC' })?.slot === 'SPEC', 'assembly: the texture the vertex specular is multiplied by');
  const madMask = 'ps.1.1\ntex t0\ntex t1\nmul r0, t0, c[textureFactor]\nmad r0.rgb, t1.a, v1, r0\n';
  ok(specMaskOf(madMask, { 0: 'MAIN', 1: 'SPEC' })?.slot === 'SPEC', 'or the alpha a mad multiplies it by before adding it');
  ok(specMaskOf('ps.1.1\ntex t0\nmad r0.rgb, t0, v0, v1\n', { 0: 'MAIN' })?.kind === 'unmasked', 'a specular only added is unmasked');
  ok(specMaskOf('ps.1.1\ntex t0\nmul r0.rgb, t0, v0\n+\nmov r0.a, c[alphaFadeOpacity]\n', { 0: 'MAIN' })?.kind === 'none', 'a program that never touches the specular has none');
  // A lookup (texm3x2tex, or an LKUP table) is part of the specular, never its mask.
  const lookup = 'ps.1.1\ntex t0\ntexm3x2pad t1, t0_bx2\ntexm3x2tex t2, t0_bx2\ntex t3\nmad_sat r0, t2, c[dot3LightDiffuseColor], v0\nmul r1, t2.a, t3.a\nmul r1, r1, c[dot3LightSpecularColor]\n';
  ok(specMaskOf(lookup, { 0: 'NRML', 1: 'LKUP', 2: 'LKUP', 3: 'MAIN' })?.slot === 'MAIN', "a texm3x2tex lookup's alpha is the specular, and the texture it meets is the mask");
  const table = 'ps.1.1\ntex t0\ntex t1\ntex t2\nmul r0, t2.a, c[dot3LightSpecularColor]\nmul r0, r0, t1.a\nmul r0, r0, c[materialSpecularColor]\n';
  ok(specMaskOf(table, { 0: 'MAIN', 1: 'SPEC', 2: 'LKUP' })?.slot === 'SPEC', 'and an LKUP table is never taken for the mask it is multiplied by');
  ok(specMaskOf(null as unknown as string, {}) === null && specMaskOf('float4 main() {}', {}) === null, 'no program, or one of no kind it knows, cannot be read: the old rule stands for it');
}

// ---------------------------------------------------------------- 2. the MATL

{
  /** A MATS form of one MATL tagged MAIN: four ARGB groups and a power. */
  const matl = new W();
  const groups = [[1, 0.2, 0.2, 0.2], [1, 0.8, 0.8, 0.8], [1, 0, 0, 0], [1, 0.5, 0.25, 0.125]];
  for (const g of groups) for (const v of g) matl.f32(v);
  matl.f32(35);
  const tag = new W();
  for (const ch of [...'MAIN'].reverse()) tag.u8(ch.charCodeAt(0));
  const root = parseIff(Buffer.from(encode(form('SSHT', form('0001', form('MATS', form('0000', chunk('TAG ', tag.bytes()), chunk('MATL', matl.bytes()))))))));
  const got = materialOf(root);
  ok(!!got && got.color.join() === '0.5,0.25,0.125' && got.power === 35, "a shader's highlight colour is its MATL's fourth group as RGB and its power the seventeenth float");
  ok(materialOf(parseIff(Buffer.from(encode(form('SSHT', form('0001')))))) === null, 'and a shader with none has none');
}

// ---------------------------------------------------------------- 2b. one colour texture, two shines
//
// The metal-rough image is named for the masks it was made from as well as for its colour texture: two shaders
// on one picture whose programs read their shine from two places are two images in a model, and one name for
// both embedded the first and handed it to the second.
{
  const px = (r: number) => encodePng(1, 1, Uint8Array.of(r, 200, 0, 255));
  const tri = { positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0), normals: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1), uvs: Float32Array.of(0, 0, 1, 0, 0, 1), indices: Uint16Array.of(0, 1, 2) };
  const entry = (r: number, key: string) => ({ path: 'texture/shared.dds', png: px(128), metallic: 0, roughness: 1, mr: { png: px(r), key }, spec: { mode: 'phong', color: [1, 1, 1], power: 20, mask: key }, cube: false });
  const glb = buildGlb([{ name: 'm', groups: [{ shader: 'shader/a.sht', primitives: [tri] }, { shader: 'shader/b.sht', primitives: [tri] }] }], { textures: new Map([['shader/a.sht', entry(30, 'SPEC.a:texture/a_s.dds|no mirror')], ['shader/b.sht', entry(220, 'MAIN.a|no mirror')]]) });
  const { json, bin } = readGlb(glb);
  const redOf = (name: string) => {
    const m = json.materials.find((x: { name: string }) => x.name === name);
    return glbImage(json, bin, m?.pbrMetallicRoughness?.metallicRoughnessTexture?.index)?.rgba[0];
  };
  const ia = json.materials.find((x: { name: string }) => x.name === 'shader/a.sht').pbrMetallicRoughness.metallicRoughnessTexture.index;
  const ib = json.materials.find((x: { name: string }) => x.name === 'shader/b.sht').pbrMetallicRoughness.metallicRoughnessTexture.index;
  ok(json.textures[ia].source !== json.textures[ib].source && redOf('shader/a.sht') === 30 && redOf('shader/b.sht') === 220, 'two shaders on one colour texture with two masks carry two metal-rough images, each its own red');
}

// ---------------------------------------------------------------- 3. the archives

/** The MATL's specular colour and power, read straight out of the shader's bytes (MAIN-tagged, else the first). */
function rawMatl(bytes: Buffer): { color: number[]; power: number } | null {
  const root = parseIff(bytes);
  for (const mats of findAll(root, 'MATS')) {
    const v = mats.children.find((c: { tag: string }) => c.tag === 'FORM') ?? mats;
    const tags = findAll(v, 'TAG ');
    const list = findAll(v, 'MATL');
    let first: { color: number[]; power: number } | null = null;
    for (let i = 0; i < list.length; i++) {
      const b = list[i].data as Buffer;
      const got = { color: [13, 14, 15].map((n) => b.readFloatLE(n * 4)), power: b.readFloatLE(64) };
      const t = tags[i]?.data ? Buffer.from(tags[i].data.subarray(0, 4)).reverse().toString('latin1') : null;
      if (t === 'MAIN') return got;
      first ??= got;
    }
    if (first) return first;
  }
  return null;
}

/** One channel of a picture, or its alpha, squared as the program squares it where it does. */
const channelOf = (img: Img, ch: string, i: number) => img.rgba[i * 4 + (ch === 'a' ? 3 : ch === 'g' ? 1 : ch === 'b' ? 2 : 0)];
function correlation(a: number[], b: number[]): number | null {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n;
  mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : null;
}

const vfs = await mountRetail();
if (!vfs) note('no SWG install on this machine (SWG in the environment or .env), so no real shader is converted here');
else {
  const { deps, readers } = converterDeps(vfs);
  const cache = new Map();
  /** Each pass of a shader's implementation, its program's source and the shine its program alone reads. */
  const perPass = (d: any) =>
    (d.pass?.passes ?? []).map((p: { pixelProgram: string | null; samplers: Record<number, string> }) => {
      const src = p.pixelProgram && vfs.has(p.pixelProgram) ? (programSource(vfs.read(p.pixelProgram)) as string) : null;
      return { src, sm: specMaskOf(src as string, p.samplers) };
    });
  const fromPacks = usedShaders();
  const pool = (fromPacks.size ? [...fromPacks] : vfs.list('shader/').filter((f) => f.endsWith('.sht'))).sort();
  note(`${fromPacks.size ? `${fromPacks.size} shaders the packs under ${PACKS} use` : `no packs under ${PACKS}, so every shader in the archives`} are the pool`);
  const classOf = (sm: { kind: string; slot?: string; channel?: string } | null) => (!sm ? 'unread' : sm.kind === 'mask' ? `${sm.slot}.${sm.channel}` : sm.kind);
  type Row = { shader: string; d: ReturnType<typeof describeSurface>; cls: string };
  const byClass = new Map<string, Row[]>();
  for (const s of pool) {
    if (!vfs.has(s)) continue;
    let d;
    try {
      d = describeSurface(vfs, s, cache);
    } catch {
      continue;
    }
    if (!d.main || !vfs.has(d.main)) continue;
    const cls = classOf(d.specMask);
    (byClass.get(cls) ?? byClass.set(cls, []).get(cls)!).push({ shader: s, d, cls });
  }
  note(`the pool by mask: ${[...byClass].sort((a, b) => b[1].length - a[1].length).map(([k, v]) => `${k} ${v.length}`).join(', ')}`);
  // An even spread of every class, all of a small one, at least 300 in all.
  const picked: Row[] = [];
  for (const [cls, rows] of byClass) {
    if (cls === 'unread') continue;
    const want = cls === 'none' ? 40 : 60;
    const step = Math.max(1, Math.floor(rows.length / want));
    for (let i = 0; i < rows.length && picked.filter((r) => r.cls === cls).length < want; i += step) picked.push(rows[i]);
  }
  ok(picked.length >= 300 && ['SPEC.a', 'MAIN.a', 'NRML.a', 'unmasked', 'none'].every((c) => picked.some((r) => r.cls === c)), `at least 300 shaders over every class of mask (${picked.length}: ${[...new Set(picked.map((r) => r.cls))].join(', ')})`);
  // Two small kinds, all of each (up to eighty): the shaders whose highlight is drawn only by a later pass of
  // their program (most of the long hair, the glass, the lenses), and the ones whose mask is multiplied in twice.
  const pickedSet = new Set(picked.map((r) => r.shader));
  const rowsAll = [...byClass.values()].flat();
  const laterRows = rowsAll.filter((r) => {
    const passes = perPass(r.d);
    return passes.length > 1 && passes[0].sm?.kind === 'none' && passes.slice(1).some((p: { sm: { kind: string } | null }) => p.sm && p.sm.kind !== 'none');
  });
  const squaredRows = rowsAll.filter((r) => r.d.specMask?.squared);
  for (const list of [laterRows, squaredRows]) {
    const step = Math.max(1, Math.floor(list.length / 80));
    for (let i = 0; i < list.length; i += step) if (!pickedSet.has(list[i].shader)) {
      pickedSet.add(list[i].shader);
      picked.push(list[i]);
    }
  }
  note(`${laterRows.length} shaders in the pool draw their highlight only in a later pass, ${squaredRows.length} multiply their mask in twice; each of them (an even spread of about eighty where there are more) is among the ${picked.length} checked`);

  const sources = new Map<string, Img | null>();
  const source = (path: string): Img | null => {
    const p = path.replace(/\\/g, '/').toLowerCase();
    if (!sources.has(p)) sources.set(p, vfs.has(p) ? (decodeDds(vfs.read(p)) as Img) : null);
    return sources.get(p)!;
  };
  const bad: string[] = [];
  const matlBad: string[] = [];
  const laterBad: string[] = [];
  let squaredCompared = 0;
  let correlated = 0;
  let constant = 0;
  let worstCorr = 1;
  const clothMain: number[] = [];
  for (const r of picked) {
    const entry = entryOf(vfs, r.shader, deps);
    if (!entry) continue;
    const model = writtenModel(r.shader, entry);
    const mat = model.material;
    const spec = mat?.extras?.swgSpec;
    const mr = model.image(mat?.pbrMetallicRoughness?.metallicRoughnessTexture?.index);
    const sm = r.d.specMask;
    // The highlight the client drew, as the MATL and the program say.
    const raw = rawMatl(vfs.read(r.shader));
    // The band is the pass that draws the highlight's to call: the first pass whose own program draws one.
    const drawing = perPass(r.d).find((p: { sm: { kind: string } | null }) => p.sm && p.sm.kind !== 'none');
    const prog: string = drawing?.src ?? '';
    const wantMode = sm.kind === 'none' ? 'none' : /calculateFakeAnisotropicSpecularLighting\s*\(/.test(prog.replace(/\/\/[^\n]*/g, '')) ? 'aniso' : 'phong';
    // A highlight drawn by a later pass is the shader's highlight: its mode and its mask are that pass's (the
    // pixels are checked below with every other).
    const dm = drawing?.sm;
    if (laterRows.includes(r) && (!spec || !dm || spec.mode === 'none' || !String(spec.mask).startsWith(dm.kind === 'mask' ? `${dm.slot}.${dm.channel}` : dm.kind))) laterBad.push(`${r.shader} (${JSON.stringify(spec)})`);
    const near4 = (a: number, b: number) => Math.abs(a - Math.round(b * 1e4) / 1e4) < 1e-4;
    if (!spec || spec.mode !== wantMode || !raw || !spec.color.every((v: number, i: number) => near4(v, raw.color[i])) || !near4(spec.power, raw.power)) matlBad.push(`${r.shader} (${JSON.stringify(spec)} against ${JSON.stringify(raw)}, ${wantMode})`);
    if (sm.kind === 'none') {
      if (mr && [...Array(mr.width * mr.height).keys()].some((i) => mr.rgba[i * 4] !== 0)) bad.push(`${r.shader} (none, but its red is not nought)`);
      continue;
    }
    if (sm.kind === 'unmasked') {
      const flat = !mr && Math.abs((mat.pbrMetallicRoughness.roughnessFactor ?? 0.9) - roughnessOfMask(255)) < 1e-4;
      if (!flat && !(mr && [...Array(mr.width * mr.height).keys()].every((i) => mr.rgba[i * 4] === 255))) bad.push(`${r.shader} (unmasked, but not all 255)`);
      continue;
    }
    // The channel the program reads, from the texture it names, at the written image's size (nearest).
    const named = r.d.textures.find((t: { slot: string }) => t.slot === sm.slot);
    const isMain = sm.slot === (r.d.mainSlot ?? 'MAIN') || (named && String(named.path).toLowerCase().replace(/\\/g, '/') === String(r.d.main).toLowerCase());
    const src = isMain ? source(r.d.main) : named ? source(named.path) : null;
    if (!src) continue;
    const want: number[] = [];
    for (let i = 0; i < src.width * src.height; i++) {
      const v = channelOf(src, sm.channel, i);
      want.push(sm.squared ? Math.round((v * v) / 255) : v);
    }
    if (want.every((v) => v === 255)) {
      // A full-white mask is a mask of one and needs no image of its own.
      constant++;
      const flat = !mr && Math.abs((mat.pbrMetallicRoughness.roughnessFactor ?? 0.9) - roughnessOfMask(255)) < 1e-4;
      if (!flat && !(mr && [...Array(mr.width * mr.height).keys()].every((i) => mr.rgba[i * 4] === 255))) bad.push(`${r.shader} (a full-white mask, written otherwise)`);
      continue;
    }
    if (!mr) {
      bad.push(`${r.shader} (a ${r.cls} mask and no metal-rough image)`);
      continue;
    }
    const got: number[] = [];
    const expect: number[] = [];
    let worst = 0;
    for (let y = 0; y < mr.height; y++) {
      for (let x = 0; x < mr.width; x++) {
        const sx = Math.min(src.width - 1, Math.floor((x * src.width) / mr.width));
        const sy = Math.min(src.height - 1, Math.floor((y * src.height) / mr.height));
        const e = want[sy * src.width + sx];
        const g = mr.rgba[(y * mr.width + x) * 4];
        got.push(g);
        expect.push(e);
        worst = Math.max(worst, Math.abs(g - e));
      }
    }
    const c = correlation(got, expect);
    if (c === null) {
      constant++;
      if (worst > 1) bad.push(`${r.shader} (a flat mask of ${expect[0]} written as ${got[0]})`);
      continue;
    }
    correlated++;
    if (sm.squared) squaredCompared++;
    worstCorr = Math.min(worstCorr, c);
    if (c < 0.99 || worst > 1) bad.push(`${r.shader} (${r.cls}: correlation ${c.toFixed(3)}, worst ${worst})`);
    // The two-tone cloth: the hue mask in the colour's alpha is not what the red follows.
    if (sm.slot === 'NRML') {
      const main = source(r.d.main);
      if (main) {
        const hue: number[] = [];
        for (let y = 0; y < mr.height; y++) for (let x = 0; x < mr.width; x++) hue.push(main.rgba[(Math.min(main.height - 1, Math.floor((y * main.height) / mr.height)) * main.width + Math.min(main.width - 1, Math.floor((x * main.width) / mr.width))) * 4 + 3]);
        const h = correlation(got, hue);
        if (h !== null) clothMain.push(h);
      }
    }
  }
  ok(bad.length === 0, `every one of the ${picked.length} writes the mask its program reads: ${correlated} correlated at ${worstCorr.toFixed(4)} or better, ${constant} flat; none writes no mask and unmasked all 255${bad.length ? `; not: ${bad.slice(0, 5).join(', ')}` : ''}`);
  ok(correlated >= 200, `and at least 200 of them have a mask that varies, so the correlation means something (${correlated})`);
  clothMain.sort((a, b) => a - b);
  const median = clothMain.length ? clothMain[clothMain.length >> 1] : null;
  ok(clothMain.length > 10 && median !== null && median < 0.5, `on the two-tone cloth the red follows the normal map's alpha and not the hue mask: against the colour's alpha its median correlation is ${median?.toFixed(2)} over ${clothMain.length}`);
  ok(matlBad.length === 0, `every one of them says the highlight its MATL and program give: the colour and power to four places and the band where the program calls it${matlBad.length ? `; not: ${matlBad.slice(0, 3).join(', ')}` : ''}`);
  if (!laterRows.length) note('no shader in the pool draws its highlight only in a later pass');
  else ok(laterBad.length === 0, `the ${laterRows.length} whose highlight only a later pass of the program draws carry that pass's highlight and mask, not "none" (${laterRows.slice(0, 2).map((r) => r.shader).join(', ')}, ...)${laterBad.length ? `; not: ${laterBad.slice(0, 4).join(', ')}` : ''}`);
  // By name, where the pool has them: the long hair (its band, masked by SPEC's alpha twice over) and the glass.
  for (const [s, mode, mask] of [['shader/hum_f_hair_long_hasa21.sht', 'aniso', 'SPEC.a'], ['shader/frn_all_glass_aaes20_bluespec.sht', 'phong', 'unmasked']] as const) {
    if (!rowsAll.some((r) => r.shader === s)) {
      note(`${s} is not in the pool here`);
      continue;
    }
    const entry = entryOf(vfs, s, deps);
    const mat = entry ? writtenModel(s, entry).material : null;
    const hasImage = mat?.pbrMetallicRoughness?.metallicRoughnessTexture !== undefined;
    ok(mat?.extras?.swgSpec?.mode === mode && mat.extras.swgSpec.mask === mask && hasImage, `${s.replace(/^shader\//, '')} draws ${mode === 'aniso' ? 'the band' : 'the highlight'} its second pass draws, ${mask === 'unmasked' ? 'unmasked' : `masked by ${mask}`}, with a metal-rough image (${JSON.stringify(mat?.extras?.swgSpec)})`);
  }
  if (!squaredRows.length) note('no shader in the pool multiplies its mask in twice');
  else ok(squaredCompared >= 1, `and ${squaredCompared} of the ${squaredRows.length} that multiply their mask in twice have a mask that varies and was compared, squared, texel by texel`);

  // The cube: on every shader with one (an ENVM or IRID slot, or a program that lerps toward one) and off
  // every other, which is no metal. Measured over a spread of the archives' cube shaders and the picked rest.
  const allShaders = vfs.list('shader/').filter((f) => f.endsWith('.sht')).sort();
  const cubes: string[] = [];
  for (const s of allShaders) {
    let d;
    try {
      d = describeSurface(vfs, s, cache);
    } catch {
      continue;
    }
    if (d.textures.some((t: { slot: string }) => t.slot === 'ENVM' || t.slot === 'IRID')) cubes.push(s);
  }
  note(`${cubes.length} shaders in the archives name a cube (the research counted 1,400)`);
  const cubeBad: string[] = [];
  let cubeChecked = 0;
  const step = Math.max(1, Math.floor(cubes.length / 150));
  for (let i = 0; i < cubes.length; i += step) {
    const entry = entryOf(vfs, cubes[i], deps);
    if (!entry) continue;
    cubeChecked++;
    const mat = writtenModel(cubes[i], entry).material;
    if (mat?.extras?.swgCube !== true || !(mat.pbrMetallicRoughness.metallicFactor > 0)) cubeBad.push(`${cubes[i]} (${JSON.stringify(mat?.extras?.swgCube)}, metal ${mat?.pbrMetallicRoughness?.metallicFactor})`);
  }
  let plainChecked = 0;
  let plainOff = 0;
  for (const r of picked) {
    if (r.d.envMask || r.d.textures.some((t: { slot: string }) => t.slot === 'ENVM' || t.slot === 'IRID')) continue;
    const entry = entryOf(vfs, r.shader, deps);
    if (!entry) continue;
    const mat = writtenModel(r.shader, entry).material;
    plainChecked++;
    // With no mirror term in its program and no cube slot, a shader reflects only where its effect's own stages
    // read a cube its shader names no file for; every other is no cube, and no metal.
    const stagesCube = [...readers.effectTags(r.d.effect)].some((t) => t === 'ENVM' || t === 'IRID');
    if (mat?.extras?.swgCube === undefined) cubeBad.push(`${r.shader} (no swgCube)`);
    else if (mat.extras.swgCube !== stagesCube) cubeBad.push(`${r.shader} (swgCube ${mat.extras.swgCube}, its effect's stages ${stagesCube ? 'read' : 'read no'} cube)`);
    else if (mat.extras.swgCube === false && mat.pbrMetallicRoughness.metallicFactor !== 0) cubeBad.push(`${r.shader} (no cube, metal ${mat.pbrMetallicRoughness.metallicFactor})`);
    if (mat?.extras?.swgCube === false) plainOff++;
  }
  ok(cubeBad.length === 0 && cubeChecked >= 100 && plainOff >= 50, `extras.swgCube is on the ${cubeChecked} cube shaders checked, with metal, and off the ${plainOff} of the ${plainChecked} others whose effect reads no cube either, which are no metal${cubeBad.length ? `; not: ${cubeBad.slice(0, 4).join(', ')}` : ''}`);

  // ---------------------------------------------------------------- 4. the packs on disk
  let checkedPacks = 0;
  for (const f of ['tatooine', 'weapons', join('wardrobe', 'human_male')]) {
    const format = packFormat(PACKS, f);
    if (format === null) continue;
    if (format < MATERIAL_FORMAT) {
      note(`${f} under ${PACKS} is material format ${format}, older than ${MATERIAL_FORMAT}: its models are not read here (status asks for it again)`);
      continue;
    }
    checkedPacks++;
    let textured = 0;
    let stamped = 0;
    let masked = 0;
    const off: string[] = [];
    const kept: string[] = [];
    for (const file of glbsUnder(join(PACKS, f), 300)) {
      const { json, bin } = readGlb(readFileSync(file));
      // A model no material of which says its highlight was not rewritten by the last run at all: a file left
      // from an earlier run (36 on Tatooine after the pass's conversion, and five the manifest still names --
      // the cantina's far level, Watto's junk shop, the Lucky Despot's engine debris and two house pieces --
      // which the snapshot did not write again; a known gap, see CLAUDE.md). It still draws as it always did.
      // What must never happen is a model the run did write with some materials stamped and some not.
      if (glbSpecStamped(json) === false) {
        kept.push(file);
        continue;
      }
      for (const m of json.materials ?? []) {
        if (!m?.pbrMetallicRoughness?.baseColorTexture || typeof m.name !== 'string') continue;
        textured++;
        if (m.extras?.swgSpec && typeof m.extras.swgCube === 'boolean') stamped++;
        const mrIndex = m.pbrMetallicRoughness.metallicRoughnessTexture?.index;
        const sm = m.extras?.swgSpec?.mask;
        if (mrIndex === undefined || typeof sm !== 'string' || !/^[A-Z0-9]{4}\.[argb]$/.test(sm)) continue;
        const twice = !!m.extras.swgSpec.squared;
        let d;
        try {
          d = describeSurface(vfs, m.name, cache);
        } catch {
          continue;
        }
        const [slot, ch] = sm.split('.');
        const named = d.textures.find((t: { slot: string }) => t.slot === slot);
        // The colour texture's own picture can be a bake or a paint in a pack; a mask of its own file is plain.
        if (!named || slot === (d.mainSlot ?? 'MAIN') || String(named.path).toLowerCase() === String(d.main).toLowerCase()) continue;
        const src = source(named.path);
        const mr = glbImage(json, bin, mrIndex);
        if (!src || !mr) continue;
        masked++;
        let worst = 0;
        for (let y = 0; y < mr.height; y++) {
          for (let x = 0; x < mr.width; x++) {
            const v = channelOf(src, ch, Math.min(src.height - 1, Math.floor((y * src.height) / mr.height)) * src.width + Math.min(src.width - 1, Math.floor((x * src.width) / mr.width)));
            worst = Math.max(worst, Math.abs(mr.rgba[(y * mr.width + x) * 4] - (twice ? Math.round((v * v) / 255) : v)));
          }
        }
        if (worst > 1) off.push(`${m.name} (${worst})`);
      }
    }
    if (kept.length) note(`${f}: ${kept.length} models carry no highlight at all and were not written by the last run (a file left from an earlier one, or one the snapshot did not write again); they draw as before`);
    ok(stamped === textured && off.length === 0, `${f}: all ${textured} textured materials of the models the last run wrote say their highlight and cube, and the ${masked} whose mask is a file of its own carry it in red${off.length ? `; not: ${off.slice(0, 4).join(', ')}` : ''}`);
  }
  if (!checkedPacks) note(`no pack under ${PACKS} is at material format ${MATERIAL_FORMAT} yet, so no model on disk is read here`);
}

console.log(`\nthe shine's mask: ${passed} checks passed`);
