// The dust's colour (the volumetrics design's §2.14 and §10 Tests): the family's lighter tones (`lighterTone`, the
// colour raster's bytes) times the drawn ground's own tint of its pole (the tint raster's bytes, through the tile
// program's own `groundTintOf` and `groundDecode` on the card and `groundMath`'s `tintGamma` and `srgbDecode` on the CPU),
// and the storm's colour eased toward the window's own.
//
//   1. `lighterTone` on a picture made here: the cut and the mean above it; at a tone of nought every sample, in the
//      walk's own order, so the mean is `averageColor`'s arithmetic by `Object.is`
//   2. the dust pass interpolates the tile program's two functions and declares neither of its own (read as text: no
//      copy anywhere in the volumetrics' sources), and the tile program's own pars still hold each at its place
//   3. on the CPU `tintedAt` calls `tintGamma` itself and its decode table is `srgbDecode` at every byte by `Object.is`;
//      `tintedColourIn` (the pass's mirror) and `tintedAt` over the two rasters' bytes against `tintGamma` and
//      `srgbDecode` in every tint mode, a tint of one where the tint raster's alpha is nought
//   4. the colour raster's alpha still the medium byte after a strip is filled, and the tint raster's bytes the pole's
//   5. over the packs on disk (SWG3JS_PACKS, else assets-private), every dust-giving family's lighter tones finite and
//      at least as light as its whole picture's mean
//   6. the storm's colour eased to within a twentieth of the window's in `stormEase` seconds, alike at 60 and 144 frames
//
// Plain type stripping; synthetic numbers and the packs' own pictures only, nothing printed of them but counts.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { GROUND_DECODE_GLSL, GROUND_TINT_GLSL, injectGroundTiles, makeGroundTileUniforms, type ShaderFamilyDef } from '../../../src/world/terrainTextures.ts';
import { srgbDecode, tintGamma, type TintReference } from '../../../src/world/groundMath.ts';
import { lighterTone, newStormEase, stormEaseIn, tintedColourIn } from '../../../src/world/volumetrics/airMath.ts';
import { AirRaster, BYTE_DECODE, MEDIUM_BYTE, type GroundSample } from '../../../src/world/volumetrics/airRaster.ts';
import { AIR_TUNE } from '../../../src/world/volumetrics/airTune.ts';
import { DUST_FRAGMENT } from '../../../src/world/volumetrics/airShaders.ts';
import { classifyFamily, responseOf } from '../../../src/world/volumetrics/groundResponse.ts';
import { parseTerrainTemplate } from '../../../src/swg/terrain/trn.ts';
import { decodePng } from '../png.mjs';
import { groundWorlds, PACKS } from './terrainHarness.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);
const src = (rel: string) => readFileSync(join(import.meta.dirname, '../../..', rel), 'utf8');

// --- 1. lighterTone ---
{
  // A picture of 1,000 texels: 700 dark grains (40, 30, 20) and 300 light ones (220, 190, 150), interleaved.
  const n = 1000;
  const px = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const light = i % 10 < 3;
    px[i * 4] = light ? 220 : 40;
    px[i * 4 + 1] = light ? 190 : 30;
    px[i * 4 + 2] = light ? 150 : 20;
    px[i * 4 + 3] = 255;
  }
  const out = { r: 0, g: 0, b: 0, n: 0 };
  lighterTone(px, 0, px.length, 4, 0.72, out);
  ok(out.n === 300 && out.r === 220 / 255 && out.g === 190 / 255 && out.b === 150 / 255, 'at a tone of 0.72 a picture seven tenths dark takes its light grains alone: the cut sits on them and the mean above it is theirs');
  lighterTone(px, 0, px.length, 4, 0.9, out);
  ok(out.n === 300, 'at 0.9 the cut cannot split a bin, so it still takes every sample of the lightest one');
  lighterTone(px, 0, px.length, 4, 0.5, out);
  ok(out.n === 1000, 'at a half the light grains are too few to be half the samples, so the cut goes on into the dark bin, which is taken whole: every sample');
  // A spread picture: luminance bytes 0..255 each once (a grey ramp), so the cut is where it should be.
  const ramp = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) ramp.set([i, i, i, 255], i * 4);
  lighterTone(ramp, 0, ramp.length, 4, 0.5, out);
  ok(out.n === 128 && Math.abs(out.r - (128 + 255) / 2 / 255) < 1e-12, `on a grey ramp the cut at a half is byte 128 and the mean above it ${(out.r * 255).toFixed(1)} (the lighter half's)`);
  // At a tone of nought every sample is taken in the walk's own order, so the mean is averageColor's to the bit.
  const rnd = new Uint8Array(512 * 512 * 4);
  let seed = 7;
  for (let i = 0; i < rnd.length; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    rnd[i] = seed >>> 24;
  }
  lighterTone(rnd, 0, rnd.length, 4 * 37, 0, out);
  let r = 0;
  let g = 0;
  let b = 0;
  let k = 0;
  for (let i = 0; i < rnd.length; i += 4 * 37) {
    r += rnd[i];
    g += rnd[i + 1];
    b += rnd[i + 2];
    k++;
  }
  ok(Object.is(out.r, r / k / 255) && Object.is(out.g, g / k / 255) && Object.is(out.b, b / k / 255) && out.n === k, "at a tone of nought it is averageColor's arithmetic over the same walk (every 37th texel), by Object.is");
  const tt = src('src/world/terrainTextures.ts');
  ok(tt.includes('for (let i = layer * per; i < (layer + 1) * per; i += 4 * 37) {') && tt.includes('c = new THREE.Color(r / n / 255, g / n / 255, b / n / 255).convertSRGBToLinear();') && tt.includes('lighterTone(img.data, layer * per, (layer + 1) * per, 4 * 37, tone, m);') && tt.includes('return out.setRGB(m.r, m.g, m.b).convertSRGBToLinear();'), "and the ground's own averageColor and toneColour walk it that way and convert alike (read as text)");
}

// --- 2. the dust pass takes the tile program's own two functions ---
{
  const count = (s: string, needle: string) => s.split(needle).length - 1;
  ok(count(DUST_FRAGMENT, GROUND_TINT_GLSL) === 1 && count(DUST_FRAGMENT, GROUND_DECODE_GLSL) === 1, "the dust pass holds the tile program's groundTintOf and groundDecode, once each, by interpolation");
  ok(count(DUST_FRAGMENT, 'vec3 groundTintOf(') === 1 && count(DUST_FRAGMENT, 'vec3 groundDecode(') === 1, 'and no second definition of either');
  let copies = '';
  for (const f of ['src/world/volumetrics/airShaders.ts', 'src/world/volumetrics/airGround.ts', 'src/core/fx/airVolume.ts', 'src/world/volumetrics/airField.ts']) {
    const t = src(f);
    if (t.includes('vec3 groundTintOf(') || t.includes('vec3 groundDecode(')) copies += ` ${f}`;
  }
  ok(copies === '', `no volumetrics source writes its own copy of either function (read as text)${copies ? `: ${copies}` : ''}`);
  const sh = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} as Record<string, unknown> };
  ok(injectGroundTiles(sh, makeGroundTileUniforms()), "the tile program goes into three's standard shader");
  const vt = sh.vertexShader.indexOf(GROUND_TINT_GLSL);
  const fd = sh.fragmentShader.indexOf(GROUND_DECODE_GLSL);
  ok(vt >= 0 && vt < sh.vertexShader.indexOf('vGroundTint = groundTintOf( aGroundTint );') && count(sh.vertexShader, GROUND_TINT_GLSL) === 1, "and its vertex pars hold groundTintOf once, before the line that tints the vertex");
  ok(fd >= 0 && fd < sh.fragmentShader.indexOf('gGroundAlbedo = gColour.rgb * groundDecode( vGroundTint );') && count(sh.fragmentShader, GROUND_DECODE_GLSL) === 1, 'and its fragment pars hold groundDecode once, before the albedo line');
}

// --- 3. the CPU's tint is the drawn ground's, by the same functions ---
{
  let table = true;
  for (let b = 0; b < 256; b++) if (!Object.is(BYTE_DECODE[b], srgbDecode(b / 255))) table = false;
  ok(table && BYTE_DECODE.length === 256, "the raster's decode table is srgbDecode at every byte, by Object.is");
  const rt = src('src/world/volumetrics/airRaster.ts');
  const body = rt.slice(rt.indexOf('  tintedAt(i: number, j: number'), rt.indexOf('  /** The cell under a world point'));
  ok(/import \{[^}]*\bsrgbDecode\b[^}]*\btintGammaOf\b[^}]*\} from '\.\.\/groundMath\.ts';/.test(rt) && body.includes('const tg = tintGammaOf(tc, ask, this.tg);') && body.includes('ask.cap = this.tintCap;') && body.includes('srgbDecode(tg[0])'), "tintedAt calls groundMath's tintGamma (its kept-record form, tintGammaOf) and srgbDecode itself (read as text)");
  const gm = src('src/world/groundMath.ts');
  const tgBody = gm.slice(gm.indexOf('export function tintGamma('), gm.indexOf('/** How the tint is asked for'));
  ok(tgBody.includes('return tintGammaOf(c, a, out);') && !tgBody.includes('Math.'), "and tintGamma is tintGammaOf over a kept record, nothing of its own: one arithmetic (read as text)");

  const refs: (TintReference | null)[] = [null, { rgb: [0.42, 0.37, 0.3], luminance: 0.38 }];
  const r = new AirRaster();
  r.resize(4);
  r.familyResponse = new Uint8Array([255, 255, 255, 255]);
  r.familyColour = new Uint8Array([0, 0, 0, 0]);
  const scratch = { c: [0.5, 0.5, 0.5] as [number, number, number], t: [0.5, 0.5, 0.5] as [number, number, number] };
  const tg: [number, number, number] = [0, 0, 0];
  const want: [number, number, number] = [0, 0, 0];
  const got: [number, number, number] = [0, 0, 0];
  const mirror: [number, number, number] = [0, 0, 0];
  let alike = true;
  let tried = 0;
  let seed = 11;
  const byte = () => ((seed = (seed * 1103515245 + 12345) >>> 0), seed >>> 24);
  for (const mode of [0, 1, 2, 3]) {
    for (const ref of refs) {
      for (const share of [0, 0.35, 1]) {
        r.tintMode = mode;
        r.tintRef = ref;
        r.tintCap = 1.6;
        r.tintShare = share;
        for (let t = 0; t < 200; t++) {
          const p = 0;
          r.known[0] = 1;
          r.colour[p] = byte();
          r.colour[p + 1] = byte();
          r.colour[p + 2] = byte();
          r.colour[p + 3] = MEDIUM_BYTE.land;
          const has = t % 5 !== 0;
          r.tint[p] = byte();
          r.tint[p + 1] = byte();
          r.tint[p + 2] = byte();
          r.tint[p + 3] = has ? 255 : 0;
          r.tintedAt(0, 0, got);
          tintedColourIn(r.colour, p, r.tint, p, share, srgbDecode, (c, out) => tintGamma(c, mode, ref, 1.6, out), scratch, mirror);
          if (has) tintGamma([r.tint[p] / 255, r.tint[p + 1] / 255, r.tint[p + 2] / 255], mode, ref, 1.6, tg);
          for (let ch = 0; ch < 3; ch++) want[ch] = srgbDecode(r.colour[p + ch] / 255) * (has ? 1 + (srgbDecode(tg[ch]) - 1) * share : 1);
          for (let ch = 0; ch < 3; ch++) if (!Object.is(got[ch], want[ch]) || !Object.is(mirror[ch], want[ch])) alike = false;
          tried++;
        }
      }
    }
  }
  ok(alike, `tintedAt and the pass's mirror tintedColourIn are srgbDecode(colour) × (1 + (srgbDecode(tintGamma(tint)) − 1) · share) by Object.is, in every tint mode, with and without a reference, at three shares (${tried} cells)`);
  r.tint.fill(0);
  r.colour.set([200, 150, 90, MEDIUM_BYTE.land], 0);
  r.tintMode = 2;
  r.tintShare = 1;
  r.tintedAt(0, 0, got);
  ok(Object.is(got[0], srgbDecode(200 / 255)) && Object.is(got[1], srgbDecode(150 / 255)) && Object.is(got[2], srgbDecode(90 / 255)), "a cell whose tint raster's alpha is nought (no chunk, a version-3 pack, a real-elevation world) takes a tint of one");
  r.known[0] = 0;
  ok(!r.tintedAt(0, 0, got) && !r.tintedAt(-1, 0, got) && !r.tintedAt(4, 0, got), 'and a cell not known, or off the raster, answers false');
}

// --- 4. a strip filled ---
{
  const r = new AirRaster();
  r.resize(8);
  r.familyResponse = new Uint8Array([0, 0, 0, 0, 255, 255, 255, 255]);
  r.familyColour = new Uint8Array([0, 0, 0, 0, 200, 170, 120, 255]);
  const sampler = {
    sample(x: number, _z: number, out: GroundSample): boolean {
      out.h = 0;
      out.family = 1;
      out.medium = x < 2 ? 1 : x < 4 ? 2 : 3;
      out.tint = x < 6 ? 0x806040 : -1;
      return true;
    },
  };
  r.fillAll(sampler, 0, 0, 1);
  let medium = true;
  let tint = true;
  for (let i = 0; i < 8; i++) {
    const k = i * 4;
    const x = i + 0.5;
    if (r.colour[k + 3] !== (x < 2 ? MEDIUM_BYTE.land : x < 4 ? MEDIUM_BYTE.water : MEDIUM_BYTE.lava)) medium = false;
    const want = x < 6 ? [0x80, 0x60, 0x40, 255] : [255, 255, 255, 0];
    for (let c = 0; c < 4; c++) if (r.tint[k + c] !== want[c]) tint = false;
  }
  ok(medium && r.colour[3] === 85, "after a strip is filled the colour raster's alpha is still the medium byte (land 85, water 170, lava 255)");
  ok(tint, "and the tint raster carries the pole's own colour-map bytes, alpha 255, or white at alpha nought where the terrain answered none");
  r.shift(3, 0);
  ok(r.tint[(5 * 4) + 3] === 0 && r.tint[3] === 255 && r.tint[0] === 0x80, 'the tint raster moves with the window as the colour raster does, what comes in unknown');
}

// --- 4b. the dust's tone moved: the colours painted again in place, nothing forgotten ---
{
  // Three families and one the table does not know, over land, water and lava, the heights a slope; then the colour
  // table made again (as `World.airTables` makes it when the owner's `dust.tone` dial moves) and painted in.
  const n = 12;
  const r = new AirRaster();
  r.resize(n);
  r.familyResponse = new Uint8Array([0, 0, 0, 0, 255, 255, 255, 255, 102, 230, 51, 153, 0, 255, 0, 31]);
  r.familyColour = new Uint8Array([0, 0, 0, 0, 200, 170, 120, 255, 150, 120, 90, 255, 0, 0, 0, 0]);
  const sampler = {
    sample(x: number, z: number, out: GroundSample): boolean {
      out.h = x * 0.5 - z * 0.25;
      out.family = Math.floor(x) % 5 === 4 ? 9 : Math.floor(x) % 4;
      out.medium = z < 4 ? 1 : z < 8 ? 2 : 3;
      out.tint = 0x406080;
      return true;
    },
  };
  const partial = { sample: (x: number, z: number, out: GroundSample) => (x > 10 ? false : sampler.sample(x, z, out)) };
  r.fillAll(sampler, 0, 0, 1);
  // The window moves two cells east and one south: what came along keeps the family it was painted from, the strips the
  // move uncovered are asked (some of them unknown), nothing else.
  r.shift(2, -1);
  r.fill(partial, 2, -1, 1, 2, -1, 0, 0, () => 0);
  const before = { height: r.height.slice(), response: r.response.slice(), tint: r.tint.slice(), known: r.known.slice(), medium: Array.from({ length: n * n }, (_, k) => r.colour[k * 4 + 3]), unknown: r.unknown };
  r.familyColour = new Uint8Array([0, 0, 0, 0, 230, 210, 160, 255, 90, 70, 50, 255, 7, 8, 9, 0]);
  r.dirty = false;
  r.repaintColour();
  const fresh = new AirRaster();
  fresh.resize(n);
  fresh.familyResponse = r.familyResponse;
  fresh.familyColour = r.familyColour;
  fresh.fillAll(sampler, 2, -1, 1);
  let same = true;
  let rgb = true;
  let carried = 0;
  for (let k = 0; k < n * n; k++) {
    if (r.colour[k * 4 + 3] !== before.medium[k]) same = false;
    if (!r.known[k]) continue;
    const i = k % n;
    const j = Math.floor(k / n);
    if (i < n - 2 && j > 0) carried++;
    for (let c = 0; c < 3; c++) if (r.colour[k * 4 + c] !== fresh.colour[k * 4 + c]) rgb = false;
  }
  ok(before.unknown > 0 && r.known.every((v, k) => v === before.known[k]) && r.height.every((v, k) => Object.is(v, before.height[k])) && r.response.every((v, k) => v === before.response[k]) && r.tint.every((v, k) => v === before.tint[k]) && same && r.unknown === before.unknown, `a new colour table painted in leaves every height, response, tint, medium byte and known cell as it stood (${n * n - before.unknown} known, ${before.unknown} not), where a clear forgot them all`);
  ok(rgb && r.dirty && carried > 0, `and every known cell takes the very colour bytes the same ground asked afresh would (its family's new lighter tones, the fallback for a family with none or one the table does not know), ${carried} of them carried along by the window's move rather than asked again`);
}

// --- 5. the packs on disk ---
{
  const worlds = groundWorlds();
  let families = 0;
  let dusty = 0;
  let worse = '';
  let unread = 0;
  const out = { r: 0, g: 0, b: 0, n: 0 };
  const whole = { r: 0, g: 0, b: 0, n: 0 };
  for (const w of worlds) {
    const shadersFile = join(PACKS, w, 'terrain', 'shaders.json');
    if (!existsSync(shadersFile)) continue;
    let template;
    try {
      template = parseTerrainTemplate(new Uint8Array(readFileSync(join(PACKS, w, 'terrain.trn'))));
    } catch {
      continue;
    }
    const defs = new Map<number, ShaderFamilyDef>();
    for (const f of (JSON.parse(readFileSync(shadersFile, 'utf8')) as { families: ShaderFamilyDef[] }).families) defs.set(f.id, f);
    for (const f of template.generator.shaderGroup.families.values()) {
      const give = responseOf(classifyFamily(w, f).cls).dust;
      if (!(give > 0)) continue;
      const def = defs.get(f.id);
      if (!def?.file) continue;
      const file = join(PACKS, w, def.file);
      if (!existsSync(file)) continue;
      const pic = decodePng(readFileSync(file)) as { width: number; height: number; rgba: Uint8Array } | null;
      if (!pic) {
        unread++;
        continue;
      }
      families++;
      dusty++;
      lighterTone(pic.rgba, 0, pic.rgba.length, 4 * 37, AIR_TUNE.dust.tone, out);
      lighterTone(pic.rgba, 0, pic.rgba.length, 4 * 37, 0, whole);
      const lum = (c: { r: number; g: number; b: number }) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      if (![out.r, out.g, out.b].every(Number.isFinite) || out.n === 0 || lum(out) < lum(whole) - 1e-12) worse += ` ${w}:${f.id}`;
    }
  }
  if (!families) note(`no converted worlds with ground pictures under ${PACKS}: the picture made above stands in for them`);
  else ok(worse === '', `over the packs on disk every dust-giving family's lighter tones at a tone of ${AIR_TUNE.dust.tone} are finite and at least as light as its whole picture's mean (${dusty} families over ${worlds.length} worlds${unread ? `, ${unread} pictures unread` : ''})${worse ? `; darker:${worse}` : ''}`);
}

// --- 6. the storm's colour eased ---
{
  const ease = AIR_TUNE.dust.stormEase;
  const at: number[][] = [];
  for (const fps of [60, 144]) {
    const s = newStormEase();
    s.r = 0.6;
    s.g = 0.45;
    s.b = 0.3;
    s.tr = 0.2;
    s.tg = 0.25;
    s.tb = 0.35;
    s.ease = ease;
    s.dt = 1 / fps;
    const frames = Math.round(ease * fps);
    for (let i = 0; i < frames; i++) stormEaseIn(s);
    at.push([s.r, s.g, s.b]);
  }
  const left = (v: number, from: number, to: number) => Math.abs(v - to) / Math.abs(from - to);
  ok(left(at[0][0], 0.6, 0.2) <= 0.0501 && left(at[1][0], 0.6, 0.2) <= 0.0501 && left(at[0][2], 0.3, 0.35) <= 0.0501, `the storm's colour is within a twentieth of the window's ${ease} s on (${(left(at[0][0], 0.6, 0.2) * 100).toFixed(2)}% of the way left)`);
  ok(at[0].every((v, i) => Math.abs(v - at[1][i]) < 1e-9), 'alike at 60 and 144 frames a second');
  const s = newStormEase();
  s.dt = Number.NaN;
  s.tr = 1;
  stormEaseIn(s);
  ok(s.r === newStormEase().r, 'a frame whose step is not a number moves it nowhere');
  const field = src('src/world/volumetrics/airField.ts');
  ok(field.includes('if (!r.tintedAt(i, j, out)) continue;') && field.includes('stormEaseIn(s);'), "the field's storm colour reads the window through tintedAt and eases through stormEaseIn (read as text)");
}

console.log(`\n${checks} checks passed`);
