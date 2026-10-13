// The ground's composition as arithmetic (`src/world/groundMath.ts`), which the tile program mirrors line
// for line and `__debug.groundSelfTest()` holds the drawn pixels to. Every check is of what the arithmetic
// answers, worked out again here from the client's rules:
//
//   1. sRGB's curve: each way, past one, and the round trip
//   2. the colour map's tint in each of its four modes: off is white, the client's is the byte, normalised
//      brings the world's median brightness to one with its hue kept and no pole past the cap, per channel
//      brings each median to one and holds each channel to the cap
//   3. an overlay's weight: every corner pattern's mask puts its covered corners at one and the rest at
//      nought, an opposite pair is the stronger of two quarters (or their sum, held), and the hard step
//   4. the chain of lerps: the bottom layer, each overlay over it in turn, weights handed back
//   5. the cloud layer: grey 0.2 laid over the shown colour at the alpha squared, held there at any strength,
//      never brightening, at most 23% of the way at the converted tile's own strongest texel (read out of the
//      pack, SWG3JS_PACKS else assets-private), drifting 1/256 a second each way and repeating
//   6. the flat shine: the gloss times the light over pi
//   7. the bump's lean: flat is straight up, a slope toward the picture's right is toward the world's -x the
//      client's way round and +x the other, toward its up is +z, held to a slope of five on its side
//
// These hold the arithmetic to the client's rules; `__debug.groundSelfTest()` holds the program to them.
//
// Run: node tools/swg/tests/groundMath.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { bumpNormal, CLOUD_GREY, cloudShade, cloudUv, composeTile, flatShine, LUMA, maskWeight, srgbDecode, srgbEncode, tintGamma, type MaskSample } from '../../../src/world/groundMath.ts';
import { MASK_HALF, MASK_QUARTER, MASK_THREEQUARTER, maskCode, NE, NW, SE, SW } from '../../../src/world/groundTiles.ts';
import { decodePng } from '../png.mjs';
import { PACKS } from './terrainHarness.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const note = (s: string) => console.log(`note ${s}`);
const near = (a: number, b: number, e = 1e-9) => Math.abs(a - b) <= e;

/** The cloud tile out of the first pack that names one, and its strongest texel (its grey is in its red). */
function cloudTile(): { world: string; most: number } | null {
  if (!existsSync(PACKS)) return null;
  for (const world of readdirSync(PACKS).sort()) {
    const f = join(PACKS, world, 'terrain', 'shaders.json');
    if (!existsSync(f)) continue;
    const rel = (JSON.parse(readFileSync(f, 'utf8')) as { clouds?: string | null }).clouds;
    if (!rel || !existsSync(join(PACKS, world, rel))) continue;
    const p = decodePng(readFileSync(join(PACKS, world, rel))) as { rgba: Uint8Array } | null;
    if (!p) continue;
    let most = 0;
    for (let i = 0; i < p.rgba.length; i += 4) most = Math.max(most, p.rgba[i]);
    return { world, most };
  }
  return null;
}

// ---------------------------------------------------------------- 1. sRGB

{
  ok(near(srgbDecode(0), 0) && near(srgbDecode(1), 1) && near(srgbEncode(1), 1, 1e-12), 'the curve holds nought and one each way');
  let worst = 0;
  for (let i = 0; i <= 255; i++) worst = Math.max(worst, Math.abs(srgbEncode(srgbDecode(i / 255)) - i / 255));
  ok(worst < 1e-12, `and every byte comes back through it (worst ${worst.toExponential(1)})`);
  ok(srgbDecode(1.6) > srgbDecode(1) && near(srgbDecode(1.6), Math.pow((1.6 + 0.055) / 1.055, 2.4)), 'it runs on past one by the same curve, for a normalised tint that brightens');
}

// ---------------------------------------------------------------- 2. the tint

{
  const out: [number, number, number] = [0, 0, 0];
  const ref = { rgb: [0.62, 0.55, 0.5] as const, luminance: 0.56 };
  ok(tintGamma([0.3, 0.4, 0.5], 0, ref, 1.6, out).every((v) => v === 1), 'off is white: the ground as it was');
  ok(tintGamma([0.3, 0.4, 0.5], 1, ref, 1.6, out).join() === '0.3,0.4,0.5', "the client's is the byte as it stands, in its own gamma");
  // A pole at the world's median brightness comes out at one, its hue kept.
  const median: [number, number, number] = [0.6, 0.55, 0.49];
  const m = median[0] * LUMA[0] + median[1] * LUMA[1] + median[2] * LUMA[2];
  tintGamma(median, 2, { rgb: ref.rgb, luminance: m }, 1.6, out);
  ok(near(out[0] * LUMA[0] + out[1] * LUMA[1] + out[2] * LUMA[2], 1, 1e-12) && near(out[0] / out[1], median[0] / median[1], 1e-12), 'normalised: a pole at the median brightness is brought to one with its hue kept');
  tintGamma([1, 1, 1], 2, ref, 1.6, out);
  ok(near(out[0] * LUMA[0] + out[1] * LUMA[1] + out[2] * LUMA[2], 1.6, 1e-12), 'and a white pole is held at the cap, not taken to 1/0.56');
  tintGamma([0, 0, 0], 2, ref, 1.6, out);
  ok(out.every((v) => v === 0), 'and black stays black, with nothing divided by nought');
  tintGamma([0.62, 0.55, 0.5], 3, ref, 1.6, out);
  ok(out.every((v) => near(v, 1, 1e-12)), 'per channel: the world\'s median colour comes out white');
  tintGamma([1, 0.05, 1], 3, ref, 1.6, out);
  ok(out[0] === 1.6 && out[2] === 1.6 && near(out[1], 0.05 / 0.55), 'and each channel is held to the cap on its own');
  tintGamma([0.5, 0.5, 0.5], 2, null, 1.6, out);
  ok(out.join() === '0.5,0.5,0.5', 'a world with no reference reads as white: normalised is then the client\'s own value');
}

// ---------------------------------------------------------------- 3. an overlay's weight

{
  // A mask of the converter's shape, worked out exactly: the quarter covers the image's top-left, the half its left
  // side, the three-quarter all but the bottom-right; bilinear between corners, which is all the test needs.
  const corner = (k: number, u: number, v: number) => {
    const at = [
      [1, 0, 0, 0],
      [1, 0, 1, 0],
      [1, 1, 1, 0],
    ][k];
    return (at[0] * (1 - u) + at[1] * u) * (1 - v) + (at[2] * (1 - u) + at[3] * u) * v;
  };
  const sample: MaskSample = (k, u, v) => corner(k, u, v);
  const places: [number, number, number][] = [
    [SW, 0, 0],
    [SE, 1, 0],
    [NW, 0, 1],
    [NE, 1, 1],
  ];
  let wrong = 0;
  for (let bits = 1; bits < 15; bits++) {
    const code = maskCode(bits);
    for (const [bit, s, t] of places) {
      const w = maskWeight(code, s, t, sample, false, true);
      if (Math.abs(w - (bits & bit ? 1 : 0)) > 1e-12) wrong++;
    }
  }
  ok(wrong === 0, 'every corner pattern of one, two or three corners (the two opposite pairs included) puts its covered corners at one and the rest at nought');
  ok(maskCode(15) === 0 && maskCode(0) === 0, 'a family on all four corners, or none, is no overlay at all');
  ok(maskCode(SW) !== maskCode(SE) && maskCode(SW | NW) !== maskCode(SW | SE) && maskCode(SW | SE | NW) !== maskCode(SE | NW | NE), 'each corner, side and three-corner pattern has a turn of its own');
  // The opposite pair at its middle: the stronger of two quarters, or their sum held to one.
  const diag = maskCode(SW | NE);
  ok(near(maskWeight(diag, 0.5, 0.5, sample, false, true), 0.25) && near(maskWeight(diag, 0.5, 0.5, sample, true, true), 0.5), 'two opposite corners take the stronger of two quarters, or with `add` their sum held to one');
  ok(maskWeight(maskCode(SW), 0.2, 0.2, sample, false, false) === 1 && maskWeight(maskCode(SW), 0.4, 0.4, sample, false, false) === 0, 'and with the masks off the weight steps at a half (0.64 is one, 0.36 nought)');
  ok(maskWeight(0, 0, 0, sample, false, true) === 0, 'no code, no weight');
  // The kinds read the right mask: the half of a side takes the half's texture, a corner the quarter's.
  const seen: number[] = [];
  maskWeight(maskCode(SW | NW), 0.3, 0.3, (k) => (seen.push(k), 0), false, true);
  maskWeight(maskCode(NE), 0.3, 0.3, (k) => (seen.push(k), 0), false, true);
  maskWeight(maskCode(SW | SE | NE), 0.3, 0.3, (k) => (seen.push(k), 0), false, true);
  ok(seen.join() === [MASK_HALF, MASK_QUARTER, MASK_THREEQUARTER].join(), 'a side reads the half, a corner the quarter and three corners the three-quarter');
}

// ---------------------------------------------------------------- 4. the chain

{
  const sample: MaskSample = () => 0.25;
  const layers = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const weights = [0, 0, 0];
  const out = composeTile((i, o) => o.splice(0, 3, ...layers[i]), [maskCode(SW), maskCode(NE), 0], 0.5, 0.5, sample, false, true, [0, 0, 0], weights);
  // Bottom red, a quarter of green over it, then a quarter of blue over that.
  ok(near(out[0], 0.5625) && near(out[1], 0.1875) && near(out[2], 0.25) && weights.join() === '0.25,0.25,0', 'the bottom layer, each overlay mixed over it in turn by its weight, the weights handed back');
  const one = composeTile((i, o) => o.splice(0, 3, ...layers[i]), [0, 0, 0], 0.5, 0.5, sample, false, true, [0, 0, 0]);
  ok(one.join() === '1,0,0', 'a tile of one family is its own picture and nothing else');
}

// ---------------------------------------------------------------- 5. the cloud layer

{
  // In the client's gamma the lit colour moves toward 0.2 by the alpha squared.
  const lit = 0.45;
  const a = 122 / 255;
  const f = cloudShade(lit, a, 1);
  const g = srgbEncode(lit);
  const shownAfter = srgbEncode(lit * f);
  ok(near(shownAfter, g + (CLOUD_GREY - g) * a * a, 1e-12), 'the shown colour moves toward the grey by the alpha squared, as the client blended it');
  // However strong, a cloud lays the grey on whole and no further: the shown colour is then the grey itself.
  ok(near(srgbEncode(lit * cloudShade(lit, 1, 10)), CLOUD_GREY, 1e-12) && near(cloudShade(lit, 0.9, 1e6), cloudShade(lit, 1, 1), 1e-12), 'its weight is held to one, so the strongest cloud makes the shown colour the grey and never passes it');
  // The cloud tile the converter wrote: its strongest texel, which is how far a cloud ever darkens at strength one.
  const tile = cloudTile();
  if (!tile) note(`no pack under ${PACKS} carries the cloud tile: its strongest texel is not read here`);
  else {
    const share = (tile.most / 255) ** 2;
    ok(tile.most === 122 && share < 0.23, `the converted cloud tile's strongest texel is ${tile.most} (its grey, out of ${tile.world}'s pack), so at strength one a colour goes at most ${(share * 100).toFixed(1)}% of the way to the grey, as the research measured (under 23%)`);
  }
  ok(cloudShade(lit, 0, 1) === 1 && cloudShade(0.01, 1, 1) === 1 && cloudShade(0, 1, 1) === 1, 'no alpha, no shade; and a ground darker than the grey is never brightened');
  let most = 0;
  for (let l = 0; l <= 4; l += 0.01) for (let al = 0; al <= 1; al += 0.05) most = Math.max(most, cloudShade(l, al, 1));
  ok(most <= 1, 'it never brightens anything, over the whole range and past one');
  ok(cloudShade(lit, a, 0) === 1 && cloudShade(lit, a, 2) < f, 'its strength scales it, nought taking it off');
  const p: [number, number] = [0, 0];
  const q: [number, number] = [0, 0];
  cloudUv(100, 50, 1, 10, p);
  cloudUv(100, 50, 1, 11, q);
  ok(near(q[0] - p[0], 1 / 256) && near(q[1] - p[1], -1 / 256), 'it drifts 1/256 of a tile each way a second (+x, -z): about 1.4 m a second');
  cloudUv(100, 50, 1, 10 + 256, q);
  ok(near(q[0], p[0]) && near(q[1], p[1]), 'and its clock repeats every 256 seconds with no seam, so a wrapped clock never jumps the picture');
  cloudUv(100, 50, -1, 10, q);
  ok(near(q[0], -100 / 256 + 10 / 256) && near(q[1], p[1]), 'the other way round the picture runs along the other x');
}

// ---------------------------------------------------------------- 6. the flat shine

{
  ok(near(flatShine(Math.PI, 0.5, 1), 0.5) && flatShine(Math.PI, 0.5, 0) === 0, 'the flat shine is the gloss times the light over pi, and nought at strength nought');
}

// ---------------------------------------------------------------- 7. the bump's lean

{
  const out: [number, number, number] = [0, 0, 0];
  const unit = (v: number[]) => near(Math.hypot(v[0], v[1], v[2]), 1, 1e-12);
  bumpNormal([0.5, 0.5, 1], 1, 1, out);
  ok(near(out[0], 0) && near(out[1], 1) && near(out[2], 0), 'a flat bump leaves level ground facing straight up');
  // A bump facing the picture's right: the pictures run along the terrain's x, which is the world's -x.
  bumpNormal([1, 0.5, 1], 1, 1, out);
  const right = [...out];
  ok(unit(right) && near(right[0], -Math.SQRT1_2) && near(right[1], Math.SQRT1_2) && near(right[2], 0), "a bump facing the picture's right leans the ground toward the world's -x, the client's way round");
  bumpNormal([1, 0.5, 1], -1, 1, out);
  ok(near(out[0], -right[0]) && near(out[1], right[1]) && near(out[2], right[2]), 'and the other way round toward +x: only x turns with the pictures');
  bumpNormal([0.5, 1, 1], 1, 1, out);
  ok(unit(out) && near(out[2], Math.SQRT1_2) && near(out[0], 0), "a bump facing the picture's up leans it toward the world's +z, the terrain's own z");
  bumpNormal([1, 0.5, 1], 1, 0, out);
  ok(near(out[1], 1), 'at strength nought the bump leans nothing');
  bumpNormal([1, 0.5, 0], 1, 1, out);
  ok(unit(out) && near(out[0], -5 / Math.hypot(5, 1)), 'a bump lying on its side is held to a slope of five, never a division by nought');
}

console.log(`\n${passed} checks passed`);
