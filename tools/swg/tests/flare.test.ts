// The lens flare's arithmetic, checked without a browser: which sky bodies flare, how big they are
// on the screen, how a space zone's stars are ranked, that the occlusion's depth test is exact to
// the depth buffer's own steps near the far plane (in float32, as the shader does it), how deep a
// cloud sheet is sampled, that the starburst has no seams, and above all that the composite can
// never lift a pixel into white.
//
// The last section reads the owner's converted skies when they are there and prints only a pass or
// a fail: no value out of a pack is written down anywhere.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import {
  DISC_FILL,
  FLARE_ELEMENTS,
  FLARE_LOOK_DEFAULTS,
  MAX_CLOUD_LAYERS,
  MAX_FLARE_SOURCES,
  SPIKE_PHASES,
  angularRadius,
  burstProfile,
  cloudLod,
  discPixels,
  elevationFade,
  flareAdd,
  isFlareBody,
  overcastFade,
  rankStarGroups,
  skyDepthGap,
  smoothingRate,
  spikeId,
  tintScale,
  type FlareCelestialLike,
  type StarSpriteLike,
} from '../../../src/core/fx/flareMath.ts';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// --- 1. which bodies flare ---

const sun: FlareCelestialLike = { shader: 'shader/sun_single.sht', size: 0.55, glowSize: 0.75, image: {}, glowImage: {} };
ok(isFlareBody(sun), 'a sun shader with a disc and a glow flares');
ok(!isFlareBody({ ...sun, glowImage: null }), 'a sun whose glow image is missing does not');
ok(!isFlareBody({ ...sun, glowSize: 0 }), 'a sun with no glow size does not');
ok(!isFlareBody({ shader: 'shader/sun_yavin.sht', size: 1.7, glowSize: 0, image: {}, glowImage: null }), 'a sun-named body with no glow (the gas giant) does not');
ok(!isFlareBody({ shader: 'shader/moon_single.sht', size: 0.3, glowSize: 0.5, image: {}, glowImage: {} }), 'a moon, even with a glow, does not');
ok(!isFlareBody({ ...sun, shader: '' }), 'an empty shader slot does not');
ok(!isFlareBody({ ...sun, shader: 'shader/not_a_sun_single.sht' }), 'only a shader whose own name starts with sun_ counts');
ok(!isFlareBody(null) && !isFlareBody(undefined), 'no body does not');

// --- 2 and 3. sizes ---

ok(near(angularRadius(0.55, DISC_FILL), Math.atan((0.55 * 0.2) / 3), 1e-6), 'a disc of size 0.55 fills atan(0.55 x 0.2 / 3)');
const disc = discPixels(angularRadius(0.55, 0.2), Math.tan(Math.PI / 6), 1440);
ok(near(disc, 45.7, 0.5), `that disc is about 45.7 px at 1440 lines and a 60 degree view (${disc.toFixed(2)})`);
ok(discPixels(0.1, 0, 1000) > 0 && Number.isFinite(discPixels(0.1, 0, 1000)), 'a zero field of view gives a finite size');

// --- 4. a space zone's stars ---

const star = (shader: string, size: number, yaw: number, pitch: number, image: unknown = {}): StarSpriteLike => ({ shader, size, yaw, pitch, image });
{
  // One clear leader: a big glow with a back, a weaker pair elsewhere, a back with no glow, a radial glow.
  const g = rankStarGroups([
    star('shader/cels_star_back.sht', 0.3, 11, -10),
    star('shader/starglow.sht', 0.8, 11, -10),
    star('shader/cels_star_back.sht', 0.5, -30, -25),
    star('shader/starglow.sht', 1, -30, -25),
    star('shader/cels_star_back.sht', 0.9, 60, 5),
    star('shader/starglow_radial.sht', 0.1, 1, -40),
  ]);
  ok(g.length === 1, 'a zone whose second star is under 0.8 of the first flares one star');
  ok(g[0].yaw === -30 && g[0].pitch === -25, 'the brightest group leads');
  ok(near(g[0].score, 1.125, 1e-9), 'its score is the glow plus a quarter of the back (1.125)');
  ok(g[0].weight === 1, 'and a score over 1 weighs 1');
}
{
  const g = rankStarGroups([
    star('shader/starglow.sht', 0.5, 10, 10),
    star('shader/starglow.sht', 0.45, -10, 20),
    star('shader/starglow.sht', 0.2, 40, 0),
  ]);
  ok(g.length === 2, 'a second star at 0.9 of the first flares too');
  ok(near(g[1].weight, g[0].weight * 0.9, 1e-9), 'with 0.9 of the first one\'s weight');
  ok(near(g[0].weight, 0.5, 1e-9), 'a dim leader keeps its own score as its weight');
  ok(g[0].score >= g[1].score, 'best first');
}
{
  const g = rankStarGroups([star('shader/cels_star_back.sht', 1, 0, 0), star('shader/starglow.sht', 1, 5, 5, null)]);
  ok(g.length === 0, 'a group with only a back is left out, and a sprite with no image is ignored');
  const many = rankStarGroups([1, 0.99, 0.98, 0.97].map((s, i) => star('shader/starglow.sht', s, i, i)));
  ok(many.length <= MAX_FLARE_SOURCES, `never more than ${MAX_FLARE_SOURCES} groups`);
  ok(rankStarGroups([]).length === 0, 'an empty zone has none');
}

// --- 5. tints ---

ok(tintScale(0, 0, 0) === 0, 'a black light gives no tint');
ok(near(0.77 * tintScale(0.77, 0.68, 0.5), 1, 1e-9), 'a bright light is scaled so its brightest channel is 1');
ok(near(0.2 * tintScale(0.2, 0.1, 0.1), 0.26, 1e-9), 'a dim light is scaled to 1.3 x itself (0.26)');

// --- 6, 7, 8. fades ---

ok(elevationFade(-0.02) === 0 && elevationFade(0.05) === 1, 'the horizon fade is 0 below the horizon and 1 a little above');
{
  let mono = true;
  let last = -1;
  for (let y = -0.02; y <= 0.05; y += 0.0005) {
    const v = elevationFade(y);
    if (v < last - 1e-12) mono = false;
    last = v;
  }
  ok(mono, 'and rises monotonically between');
}
ok(smoothingRate(0, 0.05) === 0, 'no time, no change');
ok(smoothingRate(1, 0.05) > 0.999, 'a second is all the way');
ok(smoothingRate(0.016, 0) === 1, 'a zero time constant snaps');
ok(overcastFade(0) === 1 && near(overcastFade(1), 0.15, 1e-9), 'overcast 0 leaves the flare, 1 leaves 15%');
ok(overcastFade(-1) === 1 && overcastFade(2) === overcastFade(1), 'overcast is clamped to 0..1');
{
  let mono = true;
  for (let o = 0; o < 1; o += 0.01) if (overcastFade(o + 0.01) > overcastFade(o)) mono = false;
  ok(mono, 'and falls monotonically between');
}

// --- 9. the depth test is exact to the depth buffer's steps, in float32 ---

{
  const f = Math.fround;
  const NEAR = 0.05;
  const FAR = 9000;
  const STEPS = 2 ** 24 - 1;
  // What a 24-bit depth buffer stores for a distance along the view axis, as the shader reads it.
  const depthOf = (x: number) => f(Math.round(((FAR * (x - NEAR)) / (x * (FAR - NEAR))) * STEPS) / STEPS);
  // The shader's gap: near * (far - viewZ) / (viewZ * (far - near)), each step in float32.
  const gap32 = (viewZ: number) => f(f(f(NEAR) * f(f(FAR) - f(viewZ))) / f(f(viewZ) * f(f(FAR) - f(NEAR))));
  const oneMinus = (d: number) => f(1 - d);
  let allCovered = true;
  let allOpen = true;
  let clearOpen = true;
  let mirrors = true;
  for (const D of [3430, 2195, 8820, 5645]) {
    const g = gap32(D);
    if (!near(g, skyDepthGap(NEAR, FAR, D), g * 1e-5)) mirrors = false;
    const stepM = (D * D * (FAR - NEAR)) / (NEAR * FAR * STEPS);
    for (let m = 3; m <= 50; m++) {
      const nearer = D - m * stepM;
      if (!(oneMinus(depthOf(nearer)) > g)) allCovered = false;
      const farther = D + m * stepM;
      if (farther < FAR && !(oneMinus(depthOf(farther)) <= g)) allOpen = false;
    }
    if (!(oneMinus(1) <= g)) clearOpen = false;
  }
  ok(mirrors, 'skyDepthGap matches the shader\'s float32 arithmetic');
  ok(allCovered, 'depth 3 to 50 steps nearer than the sky is always read as covered');
  ok(allOpen, 'depth 3 to 50 steps beyond the sky is always read as open');
  ok(clearOpen, 'cleared depth (1.0, the portal reset quad too) is always open');
}

// --- 10. the cloud sheets' mip level ---

{
  const discR = Math.atan((0.55 * 0.2) / 3);
  const lod = cloudLod(1500, 10, Math.sin((46 * Math.PI) / 180), discR, 6300, 256);
  ok(near(lod, 2.86, 0.05), `a lower sheet with the sun 46 degrees up is sampled at about mip 2.86 (${lod.toFixed(3)})`);
  ok(cloudLod(1500, 10, 0.005, discR, 6300, 256) === 0, 'a sun on the horizon samples nothing coarse');
  ok(cloudLod(1500, 1600, 0.7, discR, 6300, 256) === 0, 'above the sheet, level 0');
  let capped = true;
  let rising = true;
  let last = -1;
  for (let y = 0.9; y >= 0.2; y -= 0.01) {
    const v = cloudLod(1500, 10, y, discR, 6300, 256);
    if (v > 8) capped = false;
    if (v < last) rising = false;
    last = v;
  }
  ok(capped, 'never past the texture\'s last level (8 for 256 texels)');
  ok(rising, 'deeper as the sun gets lower');
}

// --- 11. the composite never lifts a pixel into white ---

{
  const K = FLARE_LOOK_DEFAULTS.kneeStart;
  const C = FLARE_LOOK_DEFAULTS.ceiling;
  let nonNeg = true;
  let bounded = true;
  let underCeiling = true;
  let zeroAbove = true;
  let noCross = true;
  for (let li = 0; li <= 800; li++) {
    const l = li * 0.005;
    for (let fi = 0; fi <= 500; fi++) {
      const lf = fi * 0.01;
      const add = flareAdd(l, lf, K, C);
      if (add < 0) nonNeg = false;
      if (add > lf + 1e-12) bounded = false;
      if (l + add > Math.max(l, C) + 1e-9) underCeiling = false;
      if (l >= C && add !== 0) zeroAbove = false;
      if (l <= 1 && l + add > 1) noCross = false;
    }
  }
  ok(nonNeg, 'the flare never darkens');
  ok(bounded, 'nor adds more than it offers');
  ok(underCeiling, 'nor lifts a pixel past the ceiling');
  ok(zeroAbove, 'and adds nothing at or above the ceiling');
  ok(noCross, 'so no pixel crosses exposed 1.0, where white begins');
  ok(flareAdd(0.5, Number.NaN, K, C) === 0 && flareAdd(0.5, Infinity, K, C) === 0, 'a flare that is not a number adds nothing');
}

// --- 12. the starburst has no seams ---

{
  let integers = true;
  for (const p of SPIKE_PHASES) {
    ok(spikeId(Math.PI, p) === spikeId(-Math.PI + 1e-9, p), `the spike at -pi is the spike at pi (phase ${p})`);
    for (let a = -Math.PI; a <= Math.PI; a += 0.001) {
      const k = spikeId(a, p);
      if (!Number.isInteger(k) || k < 0 || k > 5) integers = false;
    }
  }
  ok(integers, 'every spike index is an integer 0..5');
  const N = 200000;
  let worst = 0;
  let prev = burstProfile(-Math.PI + (2 * Math.PI) / N, 0.3);
  for (let i = 2; i <= N; i++) {
    const v = burstProfile(-Math.PI + (i * 2 * Math.PI) / N, 0.3);
    worst = Math.max(worst, Math.abs(v - prev));
    prev = v;
  }
  // Across the atan seam: pi back round to just past -pi.
  worst = Math.max(worst, Math.abs(burstProfile(Math.PI, 0.3) - burstProfile(-Math.PI + (2 * Math.PI) / N, 0.3)));
  ok(worst < 2e-3, `the profile steps by less than 2e-3 between neighbouring angles (${worst.toExponential(2)})`);
}

// --- 13. the elements ---

{
  for (const kind of [0, 1, 2, 3]) {
    const those = FLARE_ELEMENTS.filter((e) => e.kind === kind);
    ok(those.length === 1 && those[0].t === 1, `exactly one element of kind ${kind}, on the sun`);
  }
  const ghosts = FLARE_ELEMENTS.filter((e) => e.kind >= 4);
  ok(ghosts.length > 0 && ghosts.every((e) => e.t !== 1 && e.size > 0 && e.size <= 0.25 && e.amp > 0 && e.amp <= 0.2 && e.chroma >= 0 && e.chroma <= 0.1), 'every ghost sits off the sun, small, faint and only a little chromatic');
  ok(FLARE_ELEMENTS.length * MAX_FLARE_SOURCES <= 32, 'the instances fit one small draw');
}

// --- 14. the look ---

{
  const L = FLARE_LOOK_DEFAULTS;
  ok(L.kneeStart > 0 && L.kneeStart < L.ceiling && L.ceiling < 1, 'the knee starts above black and the ceiling is under exposed 1.0');
  ok(L.rise > 0 && L.fall > 0, 'the visibility eases both ways');
  ok([L.core, L.veil, L.burst, L.streak, L.ghosts, L.secondaryGhosts].every((g) => g >= 0), 'no gain is negative');
  ok(L.streakThickness > 0 && L.burstCap > 0 && L.burstCap <= 0.5, 'the streak has a thickness and the starburst a cap');
}

// --- 14b. the shaders take their shared numbers from flareMath.ts ---

{
  // lensFlare.ts imports three and extensionless modules, so it is read as text rather than run.
  const src = readFileSync(new URL('../../../src/core/fx/lensFlare.ts', import.meta.url), 'utf8');
  const literalArrays = src.match(/uniform\s+\w+\s+\w+\s*\[\s*\d+\s*\]/g) ?? [];
  ok(literalArrays.length === 0, `no shader uniform array is sized by a literal (${literalArrays.join(', ') || 'none'})`);
  ok(/uSource\[\$\{N_SRC\}\]/.test(src) && /const N_SRC = MAX_FLARE_SOURCES;/.test(src), 'the source arrays are sized by MAX_FLARE_SOURCES');
  ok(/uCloud\[\$\{N_CLOUD\}\]/.test(src) && /const N_CLOUD = MAX_CLOUD_LAYERS;/.test(src), 'the cloud arrays are sized by MAX_CLOUD_LAYERS');
  const samplers = (src.match(/uniform sampler2D tCloud\d;/g) ?? []).length;
  const covers = (src.match(/cloudCover\(tCloud\d,/g) ?? []).length;
  ok(MAX_CLOUD_LAYERS === 4 && samplers === 4 && covers === 4, 'the occlusion is written out for four cloud sheets (four samplers, a vec4 of mip levels), and MAX_CLOUD_LAYERS is 4');
  ok(/\$\{glslFloat\(SPIKE_PHASES\[0\]\)\}/.test(src) && /\$\{glslFloat\(SPIKE_PHASES\[1\]\)\}/.test(src), 'the starburst\'s phases come from SPIKE_PHASES');
  ok(!/3\.0 \* a \+ [\d.]/.test(src), 'and neither phase is written out as a number in the shader');
}

// --- 15. the owner's converted skies, when present ---

const packs = new URL('../../../assets-private/', import.meta.url);
if (!existsSync(new URL('tatooine/sky.json', packs))) {
  console.log('skip  no converted packs');
} else {
  type Sky = { sun: FlareCelestialLike | null; supplementalSun: FlareCelestialLike | null; moon: FlareCelestialLike | null; supplementalMoon: FlareCelestialLike | null; space?: { celestials: StarSpriteLike[] } | null };
  const read = (id: string): Sky | null => {
    const url = new URL(`${id}/sky.json`, packs);
    return existsSync(url) ? (JSON.parse(readFileSync(url, 'utf8')) as Sky) : null;
  };
  const bodies = (s: Sky) => [s.sun, s.supplementalSun, s.moon, s.supplementalMoon].filter((c) => isFlareBody(c)).length;
  const expected: [string, number][] = [['tatooine', 2], ['gallery', 2], ['mustafar', 2], ['yavin4', 0], ['dathomir', 0], ['corellia', 1]];
  for (const [id, n] of expected) {
    const s = read(id);
    if (!s) {
      console.log(`skip  ${id}: no converted sky`);
      continue;
    }
    ok(bodies(s) === n, `${id} has ${n} flare bod${n === 1 ? 'y' : 'ies'}`);
  }
  const zones = readdirSync(packs).filter((d) => d.startsWith('space_') && existsSync(new URL(`${d}/sky.json`, packs)));
  for (const z of zones) {
    const s = read(z);
    const groups = rankStarGroups(s?.space?.celestials ?? []);
    ok(groups.length >= 1 && groups.length <= 2, `${z} flares one or two stars (${groups.length})`);
  }
}

console.log(`\n${passed} checks passed`);
