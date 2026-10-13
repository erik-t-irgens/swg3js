// The radial flora's pictures as the `radial` pass writes them (materials and ground pass, wave 5b).
//
// Every check is of what the pass wrote, read back, against the archives, never of what it decided:
//
//   1. the resample every layer goes through: a picture of the layer's own size is kept byte for byte, a larger
//      one is box filtered by its whole factor, a smaller one stretched between texel centres
//   2. `status`'s word on a world: none for a terrain with no radial flora, asked for with no file, with a file
//      of another format, from another terrain, short of pictures, or with its picture file cut short
//   3. every world the packs carry radial pictures for (SWG3JS_PACKS, else assets-private): its layer count is
//      the shaders its terrain's live radial affectors place, the picture file is exactly that many layers,
//      every layer equals its shader's MAIN texture decoded from the archives through the same resample texel
//      for texel, and every alpha reference equals the ARVS record the shader's own effect tests against
//
// Run: node tools/swg/tests/radialPack.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeDds } from '../dds.mjs';
import { findAll, isForm, parseIff } from '../iff.mjs';
import { radialStatus, sha1Of } from '../radial.mjs';
import { describeSurface } from '../surface.mjs';
import { RADIAL_FORMAT, RADIAL_JSON, RADIAL_RGBA, RADIAL_SIZE, radialPlaced, readRadialFile, resampleRgba } from '../../../src/swg/terrain/radialFile.ts';
import { parseTerrainTemplate } from '../../../src/swg/terrain/trn.ts';
import { mountRetail, PACKS } from './materialsHarness.ts';
import { groundWorlds } from './terrainHarness.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const note = (s: string) => console.log(`note ${s}`);

// ---------------------------------------------------------------- 1. the resample

{
  const S = 8;
  const pic = (w: number, h: number) => {
    const a = new Uint8Array(w * h * 4);
    for (let i = 0; i < a.length; i++) a[i] = (i * 37 + 11) & 255;
    return a;
  };
  const same = pic(S, S);
  ok(resampleRgba(same, S, S, S).every((v, i) => v === same[i]), 'a picture of the layer\'s own size is kept byte for byte');
  const big = pic(2 * S, S);
  const down = resampleRgba(big, 2 * S, S, S);
  let boxed = true;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) for (let c = 0; c < 4; c++) if (down[(y * S + x) * 4 + c] !== Math.round((big[(y * 2 * S + 2 * x) * 4 + c] + big[(y * 2 * S + 2 * x + 1) * 4 + c]) / 2)) boxed = false;
  ok(boxed, 'a picture twice as wide is box filtered two texels into one across, and kept down');
  const small = new Uint8Array([0, 0, 0, 0, 255, 255, 255, 255]);
  const up = resampleRgba(small, 2, 1, 4);
  ok(up[0] === 0 && up[4] === 64 && up[8] === 191 && up[12] === 255 && up[16] === 0, 'a smaller one is stretched between texel centres, clamped at the edges (0, 64, 191, 255 across from 0 and 255)');
}

// ---------------------------------------------------------------- 2. status

{
  // A terrain file with no radial flora is never asked for: the empty bytes of a file that will not parse read as none.
  ok(radialStatus('nowhere', null, Buffer.from('not a terrain'), null).why === null, 'a terrain that names no radial shader is never asked for');
}

// ---------------------------------------------------------------- 3. the packs

const vfs = await mountRetail();
const worlds = groundWorlds().filter((w) => existsSync(join(PACKS, w, RADIAL_JSON)));
if (!worlds.length) note(`no world under ${PACKS} carries ${RADIAL_JSON} yet: run the radial pass to check the packs`);
if (!vfs) note('no archives (SWG in the environment or .env): the layers are not held to their textures');
let layersChecked = 0;
for (const name of worlds) {
  const dir = join(PACKS, name);
  const trn = readFileSync(join(dir, 'terrain.trn'));
  const json = JSON.parse(readFileSync(join(dir, RADIAL_JSON), 'utf8'));
  const rgba = readFileSync(join(dir, RADIAL_RGBA));
  const file = readRadialFile(json);
  ok(!!file && json.radialFormat === RADIAL_FORMAT && file.size === RADIAL_SIZE, `${name}: the file reads at format ${RADIAL_FORMAT}, ${RADIAL_SIZE} square layers`);
  const placed = radialPlaced(parseTerrainTemplate(new Uint8Array(trn)).generator);
  ok(json.placed === placed.length && file!.layers === placed.length && file!.shaders.size === placed.length, `${name}: ${file!.layers} layers for the ${placed.length} shaders its live radial affectors place`);
  ok(placed.every((p) => { const e = file!.shaders.get(p.key); return !!e && e.near === p.near && e.far === p.far; }), `${name}: every placed shader has its layer, near and far as placed`);
  ok(rgba.length === file!.layers * RADIAL_SIZE * RADIAL_SIZE * 4, `${name}: the picture file is exactly ${file!.layers} layers (${rgba.length} bytes)`);
  ok(json.trn?.sha1 === sha1Of(trn), `${name}: written from the terrain file the pack carries`);
  ok(radialStatus(name, json, trn, rgba.length).why === null, `${name}: status asks nothing more of it`);
  ok(radialStatus(name, { ...json, trn: { ...json.trn, sha1: 'x' } }, trn, rgba.length).why !== null && radialStatus(name, null, trn, null).why !== null && radialStatus(name, { ...json, radialFormat: 0 }, trn, rgba.length).why !== null && radialStatus(name, json, trn, rgba.length - 4).why !== null && radialStatus(name, { ...json, layers: json.layers - 1 }, trn, rgba.length).why !== null, `${name}: status asks again with no file, another format, another terrain, a short list or a short picture file`);
  if (!vfs) continue;
  let same = 0;
  let refs = 0;
  const cache = new Map();
  for (const [key, e] of file!.shaders) {
    const d = describeSurface(vfs, `shader/${key}.sht`, cache);
    const img = decodeDds(vfs.read(d.main));
    const want = resampleRgba(img.rgba, img.width, img.height, RADIAL_SIZE);
    const at = e.layer * RADIAL_SIZE * RADIAL_SIZE * 4;
    let equal = img.width === e.width && img.height === e.height;
    for (let i = 0; equal && i < want.length; i++) if (rgba[at + i] !== want[i]) equal = false;
    if (equal) same++;
    // The ARVS record the shader's own effect tests against, read off the shader's bytes here.
    const root = parseIff(vfs.read(`shader/${key}.sht`));
    const arvs = findAll(root, 'ARVS')[0];
    const data = arvs?.children?.find((c: { tag: string }) => !isForm(c))?.data as Buffer | undefined;
    const records = new Map<string, number>();
    for (let o = 0; data && o + 5 <= data.length; o += 5) records.set(Buffer.from(data.subarray(o, o + 4)).reverse().toString('latin1'), data[o + 4]);
    const tag = d.pass?.alphaRefTag;
    if (e.alphaRef === (tag ? (records.get(tag) ?? 0) : 0)) refs++;
    layersChecked++;
  }
  ok(same === file!.shaders.size, `${name}: every layer is its shader's MAIN texture decoded from the archives through the same resample, texel for texel (${same} of ${file!.shaders.size})`);
  ok(refs === file!.shaders.size, `${name}: every alpha reference is the ARVS record its effect tests against (${refs} of ${file!.shaders.size})`);
}
if (layersChecked) note(`${layersChecked} layers held to the archives`);

console.log(`\n${passed} passed`);
