// Normal maps, decoded the way the client's own programs decode them (material format 6).
//
// The slot a map sits in decides how it is read -- CNRM is the compressed layout (x in the alpha, y in the
// green, z rebuilt), NRML plain signed RGB -- and the converter and the recolour used to guess it from the
// picture instead, wrongly on 1,157 of the shaders the game uses. So every check here is of pixels: the
// normal map a model really carries, decoded out of the GLB, against the program's own decode of the
// source the archives hold, texel by texel.
//
//   1. the shared decoder (src/swg/normalDecode.ts) on texels written by hand
//   2. what a pixel program is read to do with a normal map (`normalReadOf`)
//   3. the second coordinate set: a normal map the shader reads there is drawn there
//   4. the recolour path (`recipeNormal`), which put its own guess over every recoloured piece
//   5. with the client's archives (SWG): at least 200 shaders the packs use, of both slots, through the
//      converter's own readers and GLB writer, against the program's decode -- every one that reads its map
//      only in a later pass of its program among them; the shaders whose TCSS puts the map on the second
//      coordinate set written with that set and drawing on it, and the main-set ones never; and the shaders
//      that name a map no pass reads carrying none
//   6. with packs converted at format 6 (SWG3JS_PACKS, else assets-private): the models on disk themselves
//
// Run: node tools/swg/tests/normals.test.ts
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeNormalMap, normalLayoutOf, normalOfTexel, type NormalLayout } from '../../../src/swg/normalDecode.ts';
import { recipeNormal, type Img as RecipeImg, type Recipe, type ShaderDef } from '../../../src/player/texrender.ts';
import { decodeDds } from '../dds.mjs';
import { readGlb } from '../glbclips.mjs';
import { describeSurface, normalReadOf, programSource } from '../surface.mjs';
import { buildGlb } from '../glb.mjs';
import { MATERIAL_FORMAT } from '../surface.mjs';
import { loadShader, renderContext } from '../texrender.mjs';
import { PACKS, converterDeps, entryOf, glbImage, glbsUnder, mountRetail, packFormat, swgDir, usedShaders, writtenModel, type Img } from './materialsHarness.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const note = (s: string) => console.log(`note ${s}`);

// ---------------------------------------------------------------- 1. the decoder

{
  ok(normalLayoutOf('CNRM') === 'compressed' && normalLayoutOf('NRML') === 'plain' && normalLayoutOf('DOT3') === 'plain' && normalLayoutOf('MAIN') === null && normalLayoutOf(null) === null, 'the slot decides the layout: CNRM compressed, NRML and DOT3 plain, nothing else a normal map');
  // Four texels: flat, tilted along x, tilted along y, and one whose x and y reach past the unit circle.
  const src = Uint8Array.from([
    90, 128, 255, 128,
    10, 128, 240, 230,
    200, 40, 222, 128,
    0, 250, 0, 255,
  ]);
  const plain = decodeNormalMap(src, 2, 2, 'plain');
  ok([0, 1, 2, 3].every((i) => plain[i * 4] === src[i * 4] && plain[i * 4 + 1] === src[i * 4 + 1] && plain[i * 4 + 2] === src[i * 4 + 2] && plain[i * 4 + 3] === 255), 'a plain map is written as its own red, green and blue, byte for byte, its alpha (the height it was made from) dropped');
  const comp = decodeNormalMap(src, 2, 2, 'compressed');
  ok([0, 1, 2, 3].every((i) => comp[i * 4] === src[i * 4 + 3] && comp[i * 4 + 1] === src[i * 4 + 1] && comp[i * 4 + 3] === 255), 'a compressed map puts its alpha in red and keeps its green');
  ok(comp[2] === 255, 'and rebuilds z: one where flat');
  const x = 230 / 127.5 - 1;
  ok(Math.abs(comp[6] - Math.round((Math.sqrt(1 - x * x) * 0.5 + 0.5) * 255)) === 0, 'z is the root of what x and y leave');
  ok(comp[14] === 128, 'and nought where x and y reach past the unit circle, which three normalises as the client would');
  const out = new Uint8Array(16);
  ok(decodeNormalMap(src, 2, 2, 'plain', out) === out, 'an array handed in is written into, not replaced');
  const n = normalOfTexel(10, 128, 240, 230, 'compressed');
  ok(Math.abs(Math.hypot(...n) - 1) < 1e-9 && n[0] > 0.7, "the program's own vector for a texel is unit length and points where the alpha says");
}

// ---------------------------------------------------------------- 2. the program says which map it reads

{
  const hlslCompressed = '//hlsl ps_2_0\nsampler diffuseMap : register(s0);\nsampler normalMap : register(s1);\nfloat3 normal_t = tex2DDxt5CompressedNormal(normalMap, tcs_NRML);\n';
  const hlslPlain = '//hlsl ps_2_0\nsampler diffuseMap : register(s0);\nsampler normalMap : register(s1);\nfloat3 normal_t = signAndBias(tex2D(normalMap, tcs_NRML));\n';
  // The two-tone cloth reads one local twice: the colour, then the normal map (whose alpha is its gloss).
  const hlslLocal = '//hlsl ps_2_0\nsampler diffuseMap : register(s0);\nsampler normalMap : register(s1);\n{ float4 sample = tex2D(diffuseMap, tcs_MAIN); }\n{ float4 sample = tex2D(normalMap, tcs_NRML);\nnormal_t = signAndBias(sample.rgb);\nspecularMask = sample.a; }\n';
  const hlslNone = '//hlsl ps_2_0\nsampler diffuseMap : register(s0);\nfloat3 diffuseColor = tex2D(diffuseMap, tcs_MAIN);\n';
  const asmPad = 'ps.1.1\ntex t0\ntexm3x2pad t1, t0_bx2\ntexm3x2tex t2, t0_bx2\ntex t3\n';
  const asmDot = 'ps.1.1\ntex t0\ntex t1\ndp3_sat r0, t1_bx2, v0_bx2\n';
  const asmNone = 'ps.1.1\ntex t0\nmul r0.rgb, t0, v0\n';
  const c = normalReadOf(hlslCompressed, { 0: 'MAIN', 1: 'CNRM' });
  ok(c?.kind === 'read' && c.slot === 'CNRM' && c.layout === 'compressed', 'the compressed reader names its sampler, and the sampler its slot');
  const p = normalReadOf(hlslPlain, { 0: 'MAIN', 1: 'NRML' });
  ok(p?.kind === 'read' && p.slot === 'NRML' && p.layout === 'plain', 'signAndBias over a read is a plain map');
  const l = normalReadOf(hlslLocal, { 0: 'MAIN', 1: 'NRML' });
  ok(l?.kind === 'read' && l.slot === 'NRML', 'through a local, the nearest read before it decides (not the colour read of the same name)');
  ok(normalReadOf(hlslNone, { 0: 'MAIN' })?.kind === 'none', 'a program that reads no normal map says so');
  ok(normalReadOf(asmPad, { 0: 'NRML', 1: 'LKUP', 2: 'LKUP', 3: 'MAIN' })?.slot === 'NRML' && normalReadOf(asmDot, { 0: 'MAIN', 1: 'NRML' })?.slot === 'NRML', 'assembly: the register a texm3x2 or a dp3 takes as _bx2');
  ok(normalReadOf(asmNone, { 0: 'MAIN' })?.kind === 'none', 'and none where nothing is');
  ok(normalReadOf(null as unknown as string, {}) === null && normalReadOf('float4 main() {}', {}) === null, 'no program, or one of no kind it knows, cannot be read (the old rule stands)');
}

// ---------------------------------------------------------------- 3. the second coordinate set

{
  const onePx = Buffer.from('89504e470d0a1a0a', 'hex');
  const entry = { path: 'texture/wall.dds', png: onePx, normal: { path: 'texture/wall_n.dds#nrml', png: onePx, slot: 'NRML', layout: 'plain', set: 1 } };
  const tri = (second: boolean) => ({ positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0), normals: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1), uvs: Float32Array.of(0, 0, 1, 0, 0, 1), uvs2: second ? Float32Array.of(0, 0, 3, 0, 0, 3) : null, indices: Uint16Array.of(0, 1, 2) });
  const glb = buildGlb([{ name: 'm', groups: [{ shader: 'shader/wall.sht', primitives: [tri(true), tri(false)] }] }], { textures: new Map([['shader/wall.sht', entry]]) });
  const { json } = readGlb(glb);
  const [withSet, without] = json.meshes[0].primitives;
  ok(withSet.attributes.TEXCOORD_1 !== undefined && json.materials[withSet.material].normalTexture.texCoord === 1, 'a normal map the shader reads on set 1 is drawn on it, and the set is written');
  ok(without.attributes.TEXCOORD_1 === undefined && json.materials[without.material].normalTexture.texCoord === undefined, 'a primitive with no second set takes a copy that reads the first, as every pack before did');
  const plainEntry = { ...entry, normal: { ...entry.normal, set: undefined } };
  const glb2 = buildGlb([{ name: 'm', groups: [{ shader: 'shader/wall.sht', primitives: [tri(true)] }] }], { textures: new Map([['shader/wall.sht', plainEntry]]) });
  const j2 = readGlb(glb2).json;
  ok(j2.meshes[0].primitives[0].attributes.TEXCOORD_1 === undefined && j2.materials[0].normalTexture.texCoord === undefined, 'a normal map on the main set pays for no second set');
}

// ---------------------------------------------------------------- 4. the recolour path

const recipeOf = (tag: 'CNRM' | 'NRML', file: string): Recipe => {
  const shader: ShaderDef = { effect: 'test.eff', passes: [], textures: { [tag]: file }, addresses: {}, coordSets: {}, tfactors: {}, alphaRefs: {}, choices: [], palettes: [] };
  return { mesh: 'm', material: 'shader/x.sht', kind: 'bake', baseTag: 'MAIN', shader, slots: [] };
};
{
  // A plain map whose alpha (a height) varies far more than its red: what the old guess took for x.
  const heightInAlpha: RecipeImg = { width: 4, height: 1, rgba: Uint8Array.from([128, 128, 255, 0, 130, 120, 250, 255, 126, 140, 250, 10, 128, 128, 255, 240]) };
  const got = recipeNormal(recipeOf('NRML', 'h.png'), new Map(), {}, (f) => (f === 'h.png' ? heightInAlpha : null))!;
  ok([0, 1, 2, 3].every((i) => got.rgba[i * 4] === heightInAlpha.rgba[i * 4] && got.rgba[i * 4 + 1] === heightInAlpha.rgba[i * 4 + 1] && got.rgba[i * 4 + 2] === heightInAlpha.rgba[i * 4 + 2]), 'a recolour decodes an NRML map as plain RGB by its tag, whatever its alpha holds');
  const comp = recipeNormal(recipeOf('CNRM', 'c.png'), new Map(), {}, (f) => (f === 'c.png' ? heightInAlpha : null))!;
  ok(comp.rgba[0] === 0 && comp.rgba[4] === 255 && comp.rgba[12] === 240, 'and a CNRM map as the compressed layout, x out of the alpha');
}

// ---------------------------------------------------------------- 5. the archives

/** How a model's written normal map compares with the program's own decode of its source: worst byte and angle. */
function compare(written: Img, src: Img, layout: NormalLayout): { level: number; degrees: number } {
  let level = 0;
  let degrees = 0;
  for (let i = 0; i < src.width * src.height; i++) {
    const o = i * 4;
    const [r, g, b, a] = [src.rgba[o], src.rgba[o + 1], src.rgba[o + 2], src.rgba[o + 3]];
    // The program's decode before it normalises, written as bytes: what the map should hold.
    const x = (layout === 'compressed' ? a : r) / 127.5 - 1;
    const y = g / 127.5 - 1;
    const z = layout === 'compressed' ? Math.sqrt(Math.max(0, 1 - x * x - y * y)) : b / 127.5 - 1;
    const want = [x, y, z].map((v) => (v * 0.5 + 0.5) * 255);
    for (let c = 0; c < 3; c++) level = Math.max(level, Math.abs(written.rgba[o + c] - want[c]));
    // And the direction three lights with, against the program's own normalised vector.
    const w = [0, 1, 2].map((c) => written.rgba[o + c] / 127.5 - 1);
    const len = Math.hypot(w[0], w[1], w[2]) || 1;
    const p = normalOfTexel(r, g, b, a, layout);
    const dot = Math.min(1, Math.max(-1, (w[0] * p[0] + w[1] * p[1] + w[2] * p[2]) / len));
    degrees = Math.max(degrees, (Math.acos(dot) * 180) / Math.PI);
  }
  return { level, degrees };
}

/** The old guess, kept here only to show the test would have caught it: x out of the alpha when it varies more. */
function oldGuessIsCompressed(src: Img): boolean {
  const n = src.width * src.height;
  let sumA = 0, sumR = 0, sqA = 0, sqR = 0, count = 0;
  const step = Math.max(1, Math.floor(n / 4096));
  for (let i = 0; i < n; i += step) {
    const r8 = src.rgba[i * 4], a8 = src.rgba[i * 4 + 3];
    sumR += r8; sqR += r8 * r8; sumA += a8; sqA += a8 * a8; count++;
  }
  const varA = sqA / count - (sumA / count) ** 2;
  const varR = sqR / count - (sumR / count) ** 2;
  return varA > 4 && varA > varR * 4;
}

const vfs = await mountRetail();
if (!vfs) note('no SWG install on this machine (SWG in the environment or .env), so no real map is decoded here');
else {
  const { deps } = converterDeps(vfs);
  const cache = new Map();
  // The shaders the packs draw with, else every shader in the archives; those whose program reads a map.
  const fromPacks = usedShaders();
  const pool = fromPacks.size ? [...fromPacks] : vfs.list('shader/').filter((f) => f.endsWith('.sht'));
  note(`${fromPacks.size ? `${fromPacks.size} shaders the packs under ${PACKS} use` : `no packs under ${PACKS}, so every shader in the archives`} are the pool`);
  const reading: { shader: string; slot: string; path: string; layout: NormalLayout; second: boolean; later: boolean }[] = [];
  /** The shaders that name a normal map no pass of their program reads. */
  const unreadMaps: string[] = [];
  /**
   * What each pass of the shader's implementation reads, pass by pass, each program through its own samplers:
   * worked out here rather than taken from the converter's description, so a reading that stopped at the first
   * pass would leave a later pass's map out of the model and be caught below.
   */
  const passReads = (d: any) =>
    (d.pass?.passes ?? []).map((p: { pixelProgram: string | null; samplers: Record<number, string> }) => {
      const src = p.pixelProgram && vfs.has(p.pixelProgram) ? programSource(vfs.read(p.pixelProgram)) : null;
      return normalReadOf(src as string, p.samplers);
    });
  const describeAll = (list: string[]) => {
    for (const s of list) {
      if (!vfs.has(s)) continue;
      let d;
      try {
        d = describeSurface(vfs, s, cache);
      } catch {
        continue;
      }
      const passes = passReads(d);
      const read = passes.find((x: { kind: string } | null) => x?.kind === 'read') ?? null;
      if (passes.length && passes.every((x: { kind: string } | null) => x?.kind === 'none') && d.textures.some((t: { slot: string }) => /^(CNRM|NRML|DOT3)$/.test(t.slot))) unreadMaps.push(s);
      if (read?.kind !== 'read') continue;
      const named = d.textures.find((t: { slot: string }) => t.slot === read.slot);
      if (!named || !vfs.has(String(named.path).replace(/\\/g, '/').toLowerCase())) continue;
      // Over every retail program, what it does to a map is what its slot says; the converter decodes by the slot.
      if (normalLayoutOf(read.slot) !== read.layout) {
        ok(false, `${s}: its program reads ${read.slot} ${read.layout}, which is not what the slot says`);
      }
      // The shader's own TCSS: the map on the second coordinate set while the colour is on the first.
      const sets = d.records?.texcoordSets ?? {};
      const second = sets[read.slot] === 1 && (sets[d.mainSlot ?? 'MAIN'] ?? 0) === 0;
      reading.push({ shader: s, slot: read.slot, path: String(named.path).replace(/\\/g, '/').toLowerCase(), layout: read.layout, second, later: passes[0]?.kind !== 'read' });
    }
  };
  describeAll(pool.sort());
  // Every shader of the named maps, then an even spread of each slot, at least 200 in all.
  const named = /(^|\/)(tato_trima_n|tato_roof_trim_n|stco_filler_c_bump)\.dds$/;
  const want = new Map<string, (typeof reading)[number]>();
  for (const r of reading) if (named.test(r.path)) want.set(r.shader, r);
  // Every shader that reads its map only in a later pass (a membrane's), and every one that reads it on the
  // second coordinate set: few, and each a rule of its own.
  for (const r of reading) if (r.later || r.second) want.set(r.shader, r);
  for (const slot of ['CNRM', 'NRML']) {
    const of = reading.filter((r) => r.slot === slot);
    const step = Math.max(1, Math.floor(of.length / 140));
    for (let i = 0; i < of.length; i += step) want.set(of[i].shader, of[i]);
  }
  const picked = [...want.values()];
  const bySlot = (slot: string) => picked.filter((r) => r.slot === slot).length;
  note(`${reading.length} shaders in the pool read a normal map (${reading.filter((r) => r.slot === 'CNRM').length} CNRM, ${reading.filter((r) => r.slot === 'NRML').length} NRML); ${picked.length} checked, ${bySlot('CNRM')} CNRM and ${bySlot('NRML')} NRML`);
  ok(picked.length >= 200 && bySlot('CNRM') >= 40 && bySlot('NRML') >= 40, `at least 200 shaders of both slots are checked (${picked.length})`);
  for (const m of ['tato_trima_n', 'tato_roof_trim_n', 'stco_filler_c_bump']) {
    if (fromPacks.size && !picked.some((r) => r.path.endsWith(`/${m}.dds`))) note(`no shader the packs here use reads ${m}`);
    else ok(picked.some((r) => r.path.endsWith(`/${m}.dds`)), `the named map ${m} is among them`);
  }
  const off: string[] = [];
  let worstLevel = 0;
  let worstDegrees = 0;
  let oldWrong = 0;
  const sourceCache = new Map<string, Img>();
  const untextured: string[] = [];
  for (const r of picked) {
    const entry = entryOf(vfs, r.shader, deps);
    // A shader whose colour texture the retail archives lack is drawn untextured, with no material to carry a map.
    if (!entry) {
      untextured.push(r.shader);
      continue;
    }
    const model = writtenModel(r.shader, entry);
    const written = model?.image(model.material?.normalTexture?.index) ?? null;
    if (!sourceCache.has(r.path)) sourceCache.set(r.path, decodeDds(vfs.read(r.path)) as Img);
    const src = sourceCache.get(r.path)!;
    if (!written || written.width !== src.width || written.height !== src.height) {
      off.push(`${r.shader} (${written ? `${written.width}x${written.height} against ${src.width}x${src.height}` : 'no normal map in its model'})`);
      continue;
    }
    const c = compare(written, src, r.layout);
    worstLevel = Math.max(worstLevel, c.level);
    worstDegrees = Math.max(worstDegrees, c.degrees);
    if (c.level > 1 || c.degrees > 2) off.push(`${r.shader} (${c.level.toFixed(1)} levels, ${c.degrees.toFixed(1)} degrees)`);
    if (oldGuessIsCompressed(src) !== (r.layout === 'compressed')) oldWrong++;
  }
  if (untextured.length) note(`${untextured.length} of them have no colour texture in the retail archives and are drawn untextured (${untextured.slice(0, 3).join(', ')})`);
  // A map read only by a later pass of the program is carried, and decoded as that pass reads it (above).
  const later = picked.filter((r) => r.later && !untextured.includes(r.shader));
  if (!later.length) note('no shader here reads its normal map only in a later pass');
  else ok(later.every((r) => !off.some((o) => o.startsWith(`${r.shader} `))), `the ${later.length} that read their map only in a later pass of the program carry it (${later.slice(0, 3).map((r) => r.shader).join(', ')})`);

  // The second coordinate set, decided by the converter and written by its writer: a map the shader's own TCSS
  // puts on set 1 (with the colour on set 0) reads that set wherever the primitive carries it, and a map on the
  // main set never does, whatever the primitive carries.
  const secondBad: string[] = [];
  let secondChecked = 0;
  for (const r of picked.filter((x) => x.second)) {
    const entry = entryOf(vfs, r.shader, deps);
    if (!entry) continue;
    secondChecked++;
    const model = writtenModel(r.shader, entry, { second: true });
    const prim = model.json.meshes[0].primitives[0];
    const mat = model.json.materials[prim.material];
    if (mat?.normalTexture?.texCoord !== 1 || prim.attributes.TEXCOORD_1 === undefined) secondBad.push(`${r.shader} (texCoord ${mat?.normalTexture?.texCoord}, TEXCOORD_1 ${prim.attributes.TEXCOORD_1 !== undefined})`);
  }
  let mainChecked = 0;
  const onMain = picked.filter((x) => !x.second);
  for (let i = 0; i < onMain.length; i += Math.max(1, Math.floor(onMain.length / 40))) {
    const entry = entryOf(vfs, onMain[i].shader, deps);
    if (!entry) continue;
    mainChecked++;
    const model = writtenModel(onMain[i].shader, entry, { second: true });
    const prim = model.json.meshes[0].primitives[0];
    const mat = model.json.materials[prim.material];
    if (mat?.normalTexture?.texCoord !== undefined || (!entry.detail && prim.attributes.TEXCOORD_1 !== undefined)) secondBad.push(`${onMain[i].shader} (on the main set, written texCoord ${mat?.normalTexture?.texCoord})`);
  }
  if (!secondChecked) note('no shader here reads its normal map on the second coordinate set');
  ok(secondBad.length === 0 && mainChecked >= 20, `the ${secondChecked} shaders that read their map on the second set draw it there (texCoord 1, TEXCOORD_1 written) and the ${mainChecked} on the main set never do${secondBad.length ? `; not: ${secondBad.slice(0, 4).join(', ')}` : ''}`);

  // A normal map the shader names and no pass of its program reads is not written at all. The pool's, and the
  // archives' where the pool has only a few (every shader the owner's packs used reads the map it names once
  // every pass is read; the archives hold 533 that do not, most of them the ground's dot3 shaders, whose
  // program samples the map and never uses it), read until thirty are found.
  if (unreadMaps.length < 5) {
    const rest = vfs.list('shader/').filter((f) => f.endsWith('.sht')).sort();
    for (let i = 0; i < rest.length && unreadMaps.length < 30; i += 200) describeAll(rest.slice(i, i + 200));
  }
  const unreadBad: string[] = [];
  let unreadChecked = 0;
  for (const s of [...new Set(unreadMaps)].slice(0, 60)) {
    const entry = entryOf(vfs, s, deps);
    if (!entry) continue;
    unreadChecked++;
    const mat = writtenModel(s, entry).material;
    if (mat?.normalTexture !== undefined || entry.normal) unreadBad.push(s);
  }
  ok(unreadChecked >= 5 && unreadBad.length === 0, `the ${unreadChecked} shaders that name a normal map no pass of their program reads carry none in their models${unreadBad.length ? `; not: ${unreadBad.slice(0, 4).join(', ')}` : ''}`);
  ok(off.length === 0 && picked.length - untextured.length >= 200, `every one of the ${picked.length - untextured.length} models carries its map as the program decodes it: within one level and two degrees everywhere (worst ${worstLevel.toFixed(2)} levels, ${worstDegrees.toFixed(2)} degrees)${off.length ? `; not: ${off.slice(0, 5).join(', ')}` : ''}`);
  // Not a check of the converter: a check that this test is not vacuous. The old guess would have failed it.
  ok(oldWrong > 0, `the old guess from the picture would have decoded ${oldWrong} of these ${picked.length} the wrong way, so the test above can tell`);
  note(`of the named maps, the old guess read ${['tato_trima_n', 'tato_roof_trim_n', 'stco_filler_c_bump'].filter((m) => { const src = [...sourceCache].find(([p]) => p.endsWith(`/${m}.dds`))?.[1]; return src && oldGuessIsCompressed(src); }).join(', ') || 'none'} as compressed`);

  // A skinned model's normal map, through the converter itself (`sat`): a customizable face chooses its
  // wrinkles with its age (a TX1D choice), so the map it carries is the file the shader's own values choose,
  // in the slot the program reads, and never the base shader's own -- which on the human male's face is
  // another of the four wrinkle maps altogether, even at the face's default values.
  const swg = swgDir();
  const face = 'shader/hum_m_face.sht';
  const faceRead = vfs.has(face) ? describeSurface(vfs, face, cache).normalRead : null;
  const chosenFile = faceRead?.kind === 'read' ? (loadShader(vfs, face, renderContext()) as { textureFiles?: Map<string, string> } | null)?.textureFiles?.get(faceRead.slot) : null;
  const baseFile = faceRead?.kind === 'read' ? describeSurface(vfs, face, cache).textures.find((t: { slot: string }) => t.slot === faceRead.slot)?.path : null;
  if (!swg || !chosenFile || !baseFile || String(chosenFile).toLowerCase() === String(baseFile).toLowerCase()) note(`the human male's face chooses no wrinkle map of its own here, so the skinned path is not checked (${chosenFile} against ${baseFile})`);
  else {
    const tmp = mkdtempSync(join(tmpdir(), 'swg3js-normals-sat-'));
    try {
      const glb = join(tmp, 'hum_m.glb');
      const run = spawnSync(process.execPath, [fileURLToPath(new URL('../cli.mjs', import.meta.url)), 'sat', swg, 'appearance/hum_m.sat', glb, '--anim=idle', '--retail-only'], { encoding: 'utf8', maxBuffer: 64 * 1048576 });
      const { json, bin } = run.status === 0 && existsSync(glb) ? readGlb(readFileSync(glb)) : { json: null, bin: null };
      // A texture renderer's target is named for the mesh it is drawn on as well (`<shader>@<mesh>`).
      const m = json?.materials?.find((x: { name: string }) => x.name === face || String(x.name).startsWith(`${face}@`));
      const written = m && bin ? glbImage(json, bin, m.normalTexture?.index) : null;
      const layout = normalLayoutOf(faceRead!.kind === 'read' ? faceRead!.slot : null)!;
      const chosen = decodeDds(vfs.read(String(chosenFile).replace(/\\/g, '/').toLowerCase())) as Img;
      const base = decodeDds(vfs.read(String(baseFile).replace(/\\/g, '/').toLowerCase())) as Img;
      const toChosen = written && written.width === chosen.width && written.height === chosen.height ? compare(written, chosen, layout) : null;
      const toBase = written && written.width === base.width && written.height === base.height ? compare(written, base, layout) : null;
      ok(!!toChosen && toChosen.level <= 1 && toChosen.degrees <= 2 && (!toBase || toBase.degrees > 2), `the converted human male's face carries the wrinkle map its own values choose (${chosenFile}, ${toChosen ? `${toChosen.degrees.toFixed(2)} degrees at worst` : 'not found'}), not its base shader's (${baseFile}${toBase ? `, ${toBase.degrees.toFixed(0)} degrees off` : ''})${run.status === 0 ? '' : `; the conversion failed: ${run.stderr.slice(-300)}`}`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  // A real NRML file the old guess read as compressed, through the recolour path.
  const misread = picked.find((r) => r.slot === 'NRML' && oldGuessIsCompressed(sourceCache.get(r.path)!));
  if (!misread) note('no NRML map here that the old guess misread');
  else {
    const src = sourceCache.get(misread.path)!;
    const got = recipeNormal(recipeOf('NRML', misread.path), new Map(), {}, (f) => (f === misread.path ? (src as RecipeImg) : null))!;
    const c = compare(got as Img, src, 'plain');
    ok(c.level <= 1 && c.degrees <= 2, `a real NRML map the old guess took for compressed (${misread.path}) decodes plain by its tag in the recolour path too (${c.degrees.toFixed(2)} degrees at worst)`);
  }

  // ---------------------------------------------------------------- 6. the packs on disk
  const folders = ['tatooine', 'weapons', join('wardrobe', 'human_male'), join('characters', 'human_male')];
  let checkedPacks = 0;
  for (const f of folders) {
    const format = packFormat(PACKS, f);
    if (format === null) continue;
    if (format < MATERIAL_FORMAT) {
      note(`${f} under ${PACKS} is material format ${format}, older than ${MATERIAL_FORMAT}: its models are not read here (status asks for it again)`);
      continue;
    }
    checkedPacks++;
    const bad: string[] = [];
    let materials = 0;
    for (const file of glbsUnder(join(PACKS, f), 400)) {
      const { json, bin } = readGlb(readFileSync(file));
      for (const m of json.materials ?? []) {
        if (m?.normalTexture?.index === undefined || typeof m.name !== 'string') continue;
        let d;
        try {
          d = describeSurface(vfs, m.name, cache);
        } catch {
          continue;
        }
        const read = d.normalRead;
        const slot = read?.kind === 'read' ? read.slot : null;
        const path = slot ? String(d.textures.find((t: { slot: string }) => t.slot === slot)?.path ?? '').replace(/\\/g, '/').toLowerCase() : '';
        if (!slot || !path || !vfs.has(path)) continue;
        const written = glbImage(json, bin, m.normalTexture.index);
        const src = sourceCache.get(path) ?? (decodeDds(vfs.read(path)) as Img);
        sourceCache.set(path, src);
        materials++;
        if (!written || written.width !== src.width) {
          bad.push(`${m.name} (size)`);
          continue;
        }
        const c = compare(written, src, normalLayoutOf(slot)!);
        if (c.level > 1 || c.degrees > 2) bad.push(`${m.name} in ${file.slice(PACKS.length)} (${c.degrees.toFixed(1)} degrees)`);
      }
    }
    ok(bad.length === 0, `${f}: the ${materials} normal maps its models carry are the programs' own decode${bad.length ? `; not: ${bad.slice(0, 4).join(', ')}` : ''}`);
  }
  if (!checkedPacks) note(`no pack under ${PACKS} is at material format ${MATERIAL_FORMAT} yet, so no model on disk is read here`);
}

console.log(`\nnormal maps: ${passed} checks passed`);
