// The colour grade's arithmetic, checked without a browser. Everything the grade does to a pixel
// lives in one dependency-free module, so this is where the guards are proved: that a tint never
// changes how bright a pixel is, that the contrast cannot crush a shadow or clip a highlight, that
// a raise in saturation never drives a channel negative, and that every parameter stays inside the
// range the design set for it, whatever nonsense a look is given.
//
// The last section is the brief itself, run against the owner's own converted skies when they are
// there: warmer and richer on one planet, colder and greyer on another, hot on the third. It reads
// the packs at run time and prints only a pass or a fail with a rounded delta; no value out of a
// pack is written down anywhere.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  GRADE_LOOKS,
  applyGradePixel,
  createGradeParams,
  createGradeSource,
  deriveGrade,
  createGradeTerms,
  ditherWeight,
  grainResponse,
  gradePivot,
  limitChroma,
  luma,
  normLuma,
  saturationOf,
  smoothSource,
  sourceLag,
  vignetteFactor,
  warmthOf,
  type GradeLook,
  type GradeParams,
  type GradeSource,
  type Vec3,
} from '../../../src/core/fx/gradeMath.ts';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const params = createGradeParams();
const terms = createGradeTerms();

function source(key: Vec3, fill: Vec3, air: Vec3, night = 0, space = false): GradeSource {
  return { key: [...key] as Vec3, fill: [...fill] as Vec3, air: [...air] as Vec3, night, space };
}

function derive(src: GradeSource, look?: GradeLook, exposure = 1): GradeParams {
  return deriveGrade(src, look, exposure, params, terms);
}

// --- 1. a bright warm sun, with no look of its own ---

const warmSun = source([0.95, 0.85, 0.66], [0.35, 0.33, 0.3], [0.45, 0.38, 0.3]);
let p = derive(warmSun);
ok(terms.gloom === 0 && terms.heat === 0 && terms.sunny === 1, 'a bright day with no look is sunny, with no gloom and no heat');
ok(p.balance[0] > p.balance[2], 'a warm key light leans the white balance warm');
ok(near(p.saturation, 1.08, 1e-9), 'a sunny day lifts saturation to 1.08');
ok(p.contrast > 1 && p.contrast < 1.05, `a hard key against a soft fill firms the contrast a little (${p.contrast.toFixed(3)})`);
const plainWarmth = warmthOf(p.balance);

// --- 2. the same sun with the warm planet's look ---

p = derive(warmSun, GRADE_LOOKS.tatooine);
ok(warmthOf(p.balance) - plainWarmth >= 0.01, 'the warm look pushes the balance warmer still');
ok(near(p.saturation, 1.11, 1e-9), 'and adds its own richness, to 1.11');

// --- 3. a dim rust sun: dimness alone is not a mood ---

const rustSun = source([0.4, 0.28, 0.18], [0.14, 0.12, 0.1], [0.25, 0.2, 0.14]);
p = derive(rustSun);
ok(terms.gloom === 0 && near(p.saturation, 1.08, 1e-9), 'a dim key with no look is still a plain sunny day: the mood is never read from the sky');
const plainHighlightSat = saturationOf(p.highlightTint);
p = derive(rustSun, { gloom: 1 });
ok(near(p.saturation, 0.8, 1e-9), 'full gloom cuts saturation to the mood floor of 0.8');
ok(p.shadowTint[2] > p.shadowTint[0], 'and turns the shadows toward steel blue');
ok(saturationOf(p.highlightTint) < plainHighlightSat, 'and washes the highlights toward white');
p = derive(rustSun, GRADE_LOOKS.dathomir);
ok(near(terms.gloom, 0.8, 1e-9), 'the bleak planet carries gloom 0.8');
ok(p.balance[2] > p.balance[0], 'its balance reads cold');
ok(p.saturation < 0.78, `and its own cut survives the mood clamp (${p.saturation.toFixed(3)})`);

// --- 4. a furnace key ---

const furnace = source([0.9, 0.144, 0.0108], [0.01, 0.01, 0.012], [0.02, 0.005, 0.001]);
p = derive(furnace, GRADE_LOOKS.mustafar);
ok(terms.heat === 1 && terms.gloom === 0, 'the hot planet is all heat and no gloom');
ok(p.balance[0] / p.balance[2] > 1.2, `heat follows the key light's hue a long way (${(p.balance[0] / p.balance[2]).toFixed(3)})`);
ok(near(p.saturation, 1.14, 1e-9), 'and lifts saturation to 1.14');
const furnaceNight = source([0.9, 0.144, 0.0108], [0.01, 0.01, 0.012], [0.02, 0.005, 0.001], 1);
p = derive(furnaceNight, GRADE_LOOKS.mustafar);
ok(near(p.saturation, 1.02, 1e-9), 'heat holds through the night, at 1.02');
ok(terms.cool === 0, 'and cancels the night’s cool entirely');
p = derive(furnace);
ok(p.balance[0] / p.balance[2] < 1.2, 'without the look the same key moves the balance far less');

// --- 5. a moonlit night ---

const moonlit = source([0.22, 0.26, 0.4], [0.06, 0.07, 0.09], [0.05, 0.06, 0.08], 1);
p = derive(moonlit);
ok(terms.gloom === 0 && near(p.saturation, 0.88, 1e-9), 'a night with no look sits at saturation 0.88');
ok(p.balance[2] > p.balance[0], 'and reads cool');
ok(p.contrast <= 1.03, `with the contrast bonus mostly withdrawn (${p.contrast.toFixed(3)})`);
ok(near(terms.cool, 0.5, 1e-9), 'the night’s own cool term is a half');
const nightBalance: Vec3 = [p.balance[0], p.balance[1], p.balance[2]];
p = derive(moonlit, GRADE_LOOKS.tatooine);
ok(near(p.balance[0], nightBalance[0], 1e-12) && near(p.balance[1], nightBalance[1], 1e-12) && near(p.balance[2], nightBalance[2], 1e-12), 'a look’s warmth fades out at night, so the balance is the night’s own');
ok(near(p.saturation, 0.91, 1e-9), 'the look’s richness still counts, at 0.91');
p = derive(moonlit, GRADE_LOOKS.dathomir);
ok(near(terms.cool, 0.8, 1e-9), 'the bleak planet’s own cool adds to the night’s');

// --- 6. space ---

const zone = source([1, 0.8, 0.6], [0.1, 0.1, 0.12], [0.02, 0.02, 0.04], 0, true);
p = derive(zone, GRADE_LOOKS.mustafar);
ok(near(p.saturation, 1.05, 1e-9) && near(p.contrast, 1.05, 1e-9), 'space takes its own gentler branch');
ok(near(p.split, 0.06, 1e-9), 'with a light split');
ok(terms.heat === 0 && terms.gloom === 0 && terms.night === 0, 'and no planet’s mood follows the player into orbit');

// --- 7. clamps and finiteness, whatever a look says ---

const absurd: (GradeLook | undefined)[] = [
  undefined,
  {},
  { gloom: 5, heat: -3, warmth: 9, cool: 4, saturation: 2, contrast: 2 },
  { gloom: 1, heat: 1, warmth: -9, cool: 1, saturation: -2, contrast: -2 },
];
const sources: GradeSource[] = [
  warmSun,
  rustSun,
  furnace,
  furnaceNight,
  moonlit,
  zone,
  source([0, 0, 0], [0, 0, 0], [0, 0, 0]),
  source([0, 0, 0], [0, 0, 0], [0, 0, 0], 1),
  source([1e4, 1e4, 1e4], [1e4, 1e4, 1e4], [1e4, 1e4, 1e4]),
];
let worstLuma = 0;
let clampsHeld = true;
for (const src of sources) {
  for (const look of absurd) {
    for (const exposure of [0.5, 1, 2, 0]) {
      const q = derive(src, look, exposure);
      const every = [...q.balance, ...q.shadowTint, ...q.highlightTint, q.split, q.saturation, q.contrast, q.pivot];
      if (!every.every((v) => Number.isFinite(v))) clampsHeld = false;
      for (const v of [q.balance, q.shadowTint, q.highlightTint]) worstLuma = Math.max(worstLuma, Math.abs(luma(v) - 1));
      if (q.saturation < 0.7 - 1e-12 || q.saturation > 1.2 + 1e-12) clampsHeld = false;
      if (q.contrast < 0.94 - 1e-12 || q.contrast > 1.1 + 1e-12) clampsHeld = false;
      if (q.split < 0 || q.split > 0.3 + 1e-12) clampsHeld = false;
    }
  }
}
ok(clampsHeld, `${sources.length * absurd.length * 4} derivations, every parameter finite and inside its range`);
ok(worstLuma < 1e-6, `every balance and tint keeps luma 1 (worst ${worstLuma.toExponential(1)})`);

// --- 8. the pivot follows the exposure ---

ok(near(gradePivot(1), 0.18, 1e-12), 'at exposure 1 the contrast turns about 0.18');
ok(near(gradePivot(2), 0.09, 1e-12), 'at exposure 2 it turns about 0.09, which is still what the player sees as mid-grey');
ok(near(gradePivot(100), 0.045, 1e-12), 'an absurd exposure is clamped at four');
ok(near(gradePivot(0), 0.72, 1e-12), 'and a zero exposure at a quarter');
ok(near(gradePivot(Number.NaN), 0.18, 1e-12), 'a reading that is not a number falls back to exposure 1');

// --- 9. the chroma limit ---

let seed = 12345;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
let limitWorstSat = 0;
let limitWorstLuma = 0;
const limited: Vec3 = [0, 0, 0];
for (let i = 0; i < 200; i++) {
  const c = normLuma([rnd(), rnd(), rnd()]);
  limitChroma(c, 0.55, limited);
  limitWorstSat = Math.max(limitWorstSat, saturationOf(limited) - 0.55);
  limitWorstLuma = Math.max(limitWorstLuma, Math.abs(luma(limited) - 1));
}
ok(limitWorstSat <= 1e-9, '200 random hues, none left more saturated than the limit');
ok(limitWorstLuma <= 1e-9, 'and every one still luma 1, so the limit costs no brightness');
ok(limitChroma([0, 0, 0], 0.55, limited)[0] === 1 && limited[1] === 1 && limited[2] === 1, 'black has no hue to limit, so it becomes plain white');

// --- 10. the pixel sweep: the guards ---

const HUES: Vec3[] = [
  normLuma([1, 1, 1]),
  normLuma([1, 0.6, 0.25]),
  normLuma([0.3, 0.45, 1]),
  normLuma([0.3, 1, 0.35]),
  normLuma([1, 0.95, 0.35]),
  normLuma([1, 0.35, 0.95]),
  normLuma([1, 0, 0]),
  normLuma([0, 0, 1]),
];
const sweepBalance = normLuma([1.3, 0.95, 0.7]);
const sweepShadow = limitChroma(normLuma([0.6, 0.8, 1.4]), 0.55, [0, 0, 0]);
const sweepHighlight = limitChroma(normLuma([1.3, 0.95, 0.6]), 0.55, [0, 0, 0]);
const out: Vec3 = [0, 0, 0];
const pixel: Vec3 = [0, 0, 0];
let sweepBad = 0;
let sweepLowest = Infinity;
let sweepHighest = -Infinity;
let toeWorst = 0;
let notMonotonic = 0;
let sweepCount = 0;
for (const saturation of [0.7, 1.2]) {
  for (const contrast of [0.94, 1.1]) {
    for (const exposure of [0.5, 1, 2]) {
      const P: GradeParams = { balance: sweepBalance, shadowTint: sweepShadow, highlightTint: sweepHighlight, split: 0.3, saturation, contrast, pivot: gradePivot(exposure) };
      for (const hue of HUES) {
        let last = -Infinity;
        for (let stop = -16; stop <= 9 + 1e-9; stop += 0.05) {
          const l0 = Math.pow(2, stop);
          pixel[0] = hue[0] * l0;
          pixel[1] = hue[1] * l0;
          pixel[2] = hue[2] * l0;
          applyGradePixel(pixel, P, 1, out);
          sweepCount++;
          if (!out.every((v) => Number.isFinite(v) && v >= 0)) sweepBad++;
          const l1 = luma(out);
          const ratio = l1 / l0;
          if (ratio < sweepLowest) sweepLowest = ratio;
          if (ratio > sweepHighest) sweepHighest = ratio;
          if (l0 <= P.pivot / 32) toeWorst = Math.max(toeWorst, Math.abs(ratio - 1));
          if (l1 < last - 1e-12) notMonotonic++;
          last = l1;
        }
      }
    }
  }
}
ok(sweepBad === 0, `${sweepCount} graded pixels over 25 stops, eight hues and twelve parameter sets: every channel a number and none negative`);
ok(sweepLowest >= 0.86 && sweepHighest <= 1.27, `the grade never moves a pixel's brightness outside ${sweepLowest.toFixed(3)} to ${sweepHighest.toFixed(3)}`);
ok(toeWorst <= 1e-9, 'and leaves the deep shadows exactly as they were');
ok(notMonotonic === 0, 'a brighter pixel never comes out darker than a dimmer one of the same hue');

// --- 11. the amount ---

const amountP: GradeParams = { balance: sweepBalance, shadowTint: sweepShadow, highlightTint: sweepHighlight, split: 0.3, saturation: 1.2, contrast: 1.1, pivot: 0.18 };
const mid: Vec3 = [0.2, 0.16, 0.1];
const none: Vec3 = [0, 0, 0];
applyGradePixel(mid, amountP, 0, none);
ok(none[0] === mid[0] && none[1] === mid[1] && none[2] === mid[2], 'at amount 0 the pixel comes back untouched');
const full: Vec3 = [0, 0, 0];
const over: Vec3 = [0, 0, 0];
applyGradePixel(mid, amountP, 1, full);
applyGradePixel(mid, amountP, 3, over);
ok(over[0] === full[0] && over[1] === full[1] && over[2] === full[2], 'and an amount past 1 is clamped to 1');
const half: Vec3 = [0, 0, 0];
applyGradePixel(mid, amountP, 0.5, half);
ok(Math.abs(luma(half) - luma(mid)) <= Math.abs(luma(full) - luma(mid)) + 1e-12, 'half the amount moves the brightness no further than the whole');

// --- 12. a raise in saturation is vibrance ---

const vib: GradeParams = { balance: [1, 1, 1], shadowTint: [1, 1, 1], highlightTint: [1, 1, 1], split: 0, saturation: 1.2, contrast: 1, pivot: 0.18 };
const strong: Vec3 = [0.4, 0.2, 0];
applyGradePixel(strong, vib, 1, out);
ok(near(saturationOf(out), saturationOf(strong), 1e-9), 'a colour already at full saturation is left where it is');
const grey: Vec3 = [0.3, 0.3, 0.3];
applyGradePixel(grey, vib, 1, out);
ok(near(out[0], out[1], 1e-12) && near(out[1], out[2], 1e-12), 'a grey stays grey');
const soft: Vec3 = [0.4, 0.3, 0.2];
applyGradePixel(soft, vib, 1, out);
ok(saturationOf(out) > saturationOf(soft), 'a muted colour gains');
const nearly: Vec3 = [0.4, 0.12, 0.01];
applyGradePixel(nearly, vib, 1, out);
ok(saturationOf(out) - saturationOf(nearly) < 0.01, 'and one that is nearly there gains almost nothing, so it cannot clip');

// --- 13. following the sky ---

const cur = createGradeSource();
const tgt = source([1, 0.5, 0.25], [0.2, 0.2, 0.3], [0.3, 0.3, 0.3], 1);
smoothSource(cur, tgt, 1);
ok(sourceLag(cur, tgt) === 0, 'a cut snaps the grade to the sky at once');
const keep = createGradeSource();
smoothSource(keep, tgt, 0);
ok(keep.key[0] === createGradeSource().key[0] && keep.night === 0, 'and a step of nothing leaves it where it was');
const midway = createGradeSource();
const startKey = midway.key[0];
smoothSource(midway, tgt, 0.5);
ok(near(midway.key[0], startKey + (tgt.key[0] - startKey) * 0.5, 1e-12) && near(midway.night, 0.5, 1e-12), 'half a step lands half way');
const lagA = createGradeSource();
const lagB = createGradeSource();
lagB.night = 0.25;
ok(near(sourceLag(lagA, lagB), 0.25, 1e-12), 'and the lag reports the largest difference there is');

// --- 14, 15, 16. the vignette, the grain and the dither ---

ok(vignetteFactor(0.5, 0.5, 1) === 1, 'the middle of the picture keeps all of its light, however heavy the vignette');
ok(near(vignetteFactor(0, 0, 1), 1 - 0.55, 1e-9), 'a corner at full strength keeps 45% of its display value');
ok(vignetteFactor(0, 0, 0) === 1 && vignetteFactor(0.2, 0.9, 0) === 1, 'and a strength of nothing changes nothing anywhere');
let vignetteRises = false;
let lastFactor = Infinity;
for (let t = 0; t <= 1 + 1e-9; t += 0.02) {
  const f = vignetteFactor(0.5 - 0.5 * t, 0.5 - 0.5 * t, 0.6);
  if (f > lastFactor + 1e-12) vignetteRises = true;
  lastFactor = f;
}
ok(!vignetteRises, 'the vignette only ever darkens further outward, never brightens');

ok(grainResponse(0) === 0 && grainResponse(1) === 0, 'grain weighs nothing at black and at white');
ok(near(grainResponse(0.5), 1, 1e-12), 'and weighs full at mid-grey');

ok(ditherWeight(0) === 0 && ditherWeight(1) === 0, 'the dither fades to nothing at black and at white, so pure black stays black');
ok(near(ditherWeight(2 / 255), 1, 1e-9) && near(ditherWeight(0.5), 1, 1e-9) && near(ditherWeight(253 / 255), 1, 1e-9), 'and is at full weight from two 8-bit steps in');
ok(near(ditherWeight(1 / 255), 0.5, 1e-9), 'with half its weight one step in');

// --- 17. the brief, against the owner's own converted skies ---

const packs = new URL('../../../assets-private/', import.meta.url);
/** The three the brief names, and what each one's look is supposed to do to sunlit ground. */
const BRIEF: { planet: string; warmth: 'up' | 'down'; saturation: 'up' | 'down' | 'held' }[] = [
  { planet: 'tatooine', warmth: 'up', saturation: 'up' },
  { planet: 'dathomir', warmth: 'down', saturation: 'down' },
  { planet: 'mustafar', warmth: 'up', saturation: 'held' },
];

const srgbToLinear = (b: number) => {
  const c = b / 255;
  return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
};

interface RampBlock {
  weatherIndex: number;
  ramp: { rows: number; rgba: string } | null;
}

/** One ramp row at one column, as the game reads it: sRGB bytes into linear, times the scale the alpha carries. */
function rampRow(bytes: Buffer, row: number, column: number, scaled: boolean): Vec3 {
  const o = (row * 256 + column) * 4;
  const c: Vec3 = [srgbToLinear(bytes[o]), srgbToLinear(bytes[o + 1]), srgbToLinear(bytes[o + 2])];
  if (!scaled) return c;
  const scale = Math.max(0, (4 * (bytes[o + 3] - 128)) / 128);
  c[0] *= scale;
  c[1] *= scale;
  c[2] *= scale;
  return c;
}

const haveAll = BRIEF.every((b) => existsSync(new URL(`${b.planet}/sky.json`, packs)));
if (!haveAll) {
  console.log('skip  converted sky packs not found, so the brief is not checked here');
} else {
  for (const want of BRIEF) {
    const data = JSON.parse(readFileSync(new URL(`${want.planet}/sky.json`, packs), 'utf8')) as { blocks: RampBlock[] };
    const blocks = data.blocks.filter((b) => b.weatherIndex === 0 && b.ramp && b.ramp.rows > 9);
    let worstWarmth = Infinity;
    let worstSaturation = Infinity;
    let negative = 0;
    for (const block of blocks) {
      const bytes = Buffer.from(block.ramp!.rgba, 'base64');
      const key = rampRow(bytes, 1, 64, true);
      const fill = rampRow(bytes, 9, 64, true);
      let air = rampRow(bytes, 6, 64, false);
      if (luma(air) <= 0.002) air = rampRow(bytes, 5, 64, false);
      const src = source(key, fill, air);
      const q = deriveGrade(src, GRADE_LOOKS[want.planet], 1, params, terms);
      // The sunlit ground, as the survey proxied it: most of the key light with some of the fill.
      const sunlit: Vec3 = [0.4 * (0.7 * key[0] + 0.5 * fill[0]), 0.4 * (0.7 * key[1] + 0.5 * fill[1]), 0.4 * (0.7 * key[2] + 0.5 * fill[2])];
      applyGradePixel(sunlit, q, 1, out);
      if (out.some((v) => v < 0)) negative++;
      const dw = warmthOf(out) - warmthOf(sunlit);
      const ds = saturationOf(out) - saturationOf(sunlit);
      worstWarmth = Math.min(worstWarmth, want.warmth === 'up' ? dw : -dw);
      worstSaturation = Math.min(worstSaturation, want.saturation === 'down' ? -ds : ds);
    }
    ok(blocks.length > 0, `${want.planet}: ${blocks.length} fair-weather blocks read from the converted sky`);
    ok(worstWarmth > 0, `${want.planet}: the sunlit ground goes ${want.warmth === 'up' ? 'warmer' : 'cooler'} on every one of them (least ${worstWarmth.toFixed(3)})`);
    if (want.saturation === 'up') ok(worstSaturation > 0, `${want.planet}: and richer on every one (least ${worstSaturation.toFixed(3)})`);
    else if (want.saturation === 'down') ok(worstSaturation >= 0.03, `${want.planet}: and greyer on every one, by at least 0.03 (least ${worstSaturation.toFixed(3)})`);
    else ok(worstSaturation >= -1e-9, `${want.planet}: and loses no richness on any (least ${worstSaturation.toFixed(3)})`);
    ok(negative === 0, `${want.planet}: and no channel of the graded ground is ever driven below zero`);
  }
}

console.log(`\n${passed} checks passed`);
