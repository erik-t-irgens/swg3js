// The wisps and the dust in every layer (the volumetrics' third wave, the design's §2.14), on their mirrors
// (src/world/volumetrics/airNoise.ts, airMath.ts) and the shaders' own lines: the noise of ours tiles across its wrap;
// the flow noise's two phases cross-fade continuously and a phase's restart carries no weight; the erosion is the input by
// `Object.is` at erode nought and at age nought, its mean keep continuous from one at an erosion of nought (the first
// version's formula, the raw noise at nought, failing as the control), holes opened past `erodeFull`, stronger at a
// patch's top and bottom than at its mean, `keepColumn` 1 holding the mean keep at one through the table; the dust's
// blended backtrace carrying a patch low on the slow layer and high on the fast one, alike at 60 and 144 frames a second;
// the bands' four heights the noise read directly at those heights; and the height-aware kill over a solid: a patch at
// 0.3 m gone over a 3 m roof, one at 6 m nearly whole and one at 3 m about half, against a numeric integral of the folded
// profile, and a blast's dust drifting over a building leaving no clean wake.
//
// Plain type stripping; synthetic numbers.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectedKeep, KEEP_TABLE, keepTable, newNoiseVolume, newWispPhase, NOISE_SIZE, noiseLayers, wispDensity, wispErosion, wispKeep, wispPhaseIn, type NoiseVolume } from '../../../src/world/volumetrics/airNoise.ts';
import { aboveSolid, dustLawIn, dustRideVelocity, dustShapeStep, foldedProfile, newDustLaw, slabShares, type ShapeTexel } from '../../../src/world/volumetrics/airMath.ts';
import { AIR_TUNE } from '../../../src/world/volumetrics/airTune.ts';
import { AIR_MARCH_SOURCE } from '../../../src/core/fx/airVolume.ts';
import { BANDS_FRAGMENT, DUST_FRAGMENT } from '../../../src/world/volumetrics/airShaders.ts';
import { glslFunctions, glslFunctionText } from './glslRun.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const source = (p: string): string => readFileSync(join(REPO, 'src', p), 'utf8').replace(/\r\n/g, '\n');
/** The commit before this wave (wave 2b's): what the column kill the height-aware kill replaced looked like. */
const PRE_WAVE = 'caad313';

// --- the noise ---
const vol: NoiseVolume = newNoiseVolume();
const t0 = performance.now();
while (!noiseLayers(vol, 8)) {
  // a slice at a time
}
const madeMs = performance.now() - t0;
const N = NOISE_SIZE;
const at = (i: number, j: number, k: number): number => vol.bytes[((((k % N) + N) % N) * N + (((j % N) + N) % N)) * N + (((i % N) + N) % N)] / 255;
{
  let inside = 0;
  let across = 0;
  for (let k = 0; k < N; k += 3) {
    for (let j = 0; j < N; j += 3) {
      for (let i = 0; i < N - 1; i++) inside = Math.max(inside, Math.abs(at(i + 1, j, k) - at(i, j, k)));
      across = Math.max(across, Math.abs(at(0, j, k) - at(N - 1, j, k)), Math.abs(at(j, 0, k) - at(j, N - 1, k)), Math.abs(at(j, k, 0) - at(j, k, N - 1)));
    }
  }
  ok(across <= inside, `the noise tiles across its wrap on every axis: its step across the edge (${across.toFixed(3)}) no larger than inside (${inside.toFixed(3)}); ${N}³ made in ${madeMs.toFixed(0)} ms`);
  let total = 0;
  for (let b = 0; b < 256; b++) total += vol.histogram[b];
  ok(total === N * N * N && vol.layers === N, 'every texel counted into the histogram as it was made, and the volume whole');
  const again = newNoiseVolume();
  noiseLayers(again, 2);
  ok(again.bytes.subarray(0, N * N * 2).every((b, i) => b === vol.bytes[i]), 'the same in every session: a fixed seed');
}

// --- the two phases ---
{
  const ph = newWispPhase();
  ph.period = AIR_TUNE.wisps.period;
  let worst = 0;
  let prev = -1;
  let restartWeight = 0;
  for (let i = 0; i <= 6000; i++) {
    ph.time = i * 0.001;
    wispPhaseIn(ph);
    if (prev >= 0) worst = Math.max(worst, Math.abs(ph.cross - prev));
    prev = ph.cross;
    // Phase zero restarts where p0 is nought: its weight (1 − cross) must be nought there, and phase one's (cross) where p1 is.
    if (ph.p0 < 0.001) restartWeight = Math.max(restartWeight, 1 - ph.cross);
    if (ph.p1 < 0.001) restartWeight = Math.max(restartWeight, ph.cross);
  }
  ok(worst < 0.01, `the cross-fade is continuous: its largest step in a millisecond ${worst.toFixed(4)}`);
  ok(restartWeight < 0.01, `and a phase's restart carries no weight (at most ${restartWeight.toFixed(4)})`);
  ok(BANDS_FRAGMENT.includes('o[b] = mix(n0, n1, uWispB.z);') && AIR_MARCH_SOURCE.includes('uWispB.z);'), "the bands and the march read phase one's weight as the cross");
}

// --- the erosion ---
const ef = AIR_TUNE.wisps.erodeFull;
const table = keepTable(vol.histogram, ef, new Float32Array(KEEP_TABLE));
const meanKeep = (e: number, rule: (n: number, e: number) => number = (n, x) => wispKeep(n, x, ef)): number => {
  let sum = 0;
  let total = 0;
  for (let b = 0; b < 256; b++) {
    if (!vol.histogram[b]) continue;
    sum += vol.histogram[b] * rule(b / 255, e);
    total += vol.histogram[b];
  }
  return sum / total;
};
{
  let ident = true;
  for (const dens of [0, 0.3, 1.7, -0, Number.NaN, 1e-9]) {
    for (const n of [0, 0.2, 0.5, 0.9, 1]) {
      if (!Object.is(wispDensity(dens, n, 0, 0.3, ef, 0, 0.25, table), dens)) ident = false;
      if (!Object.is(wispDensity(dens, n, 0.45, wispErosion(0.45, 1, 0.3, 0.25, 0, 1.5), ef, 0, 0.25, table), dens)) ident = false;
    }
  }
  ok(ident, 'at erode nought, and for fresh dust (age nought), the density is the input by Object.is: the erosion is the identity there');
  ok(wispErosion(0.45, 2, 0.3, 0.25, 0, 0) === 0.45 && wispErosion(0.45, 0.3, 0.3, 0.25, 7, 0) === 0.45 * 0.4, 'with ageWisp nought there is no age term at all (one), never a smoothstep of equal edges');
  ok(AIR_MARCH_SOURCE.includes('if (uWispB.w > 0.0) ag = smoothstep(0.0, uWispB.w, age);'), "the march asks it only while ageWisp is above nought");
  // Continuous from one at nought; the first version's formula (the raw noise at nought) is the control that steps.
  let steps = 0;
  let prev = meanKeep(0);
  for (let e = 0.005; e <= 1; e += 0.005) {
    const k = meanKeep(e);
    steps = Math.max(steps, Math.abs(k - prev));
    prev = k;
  }
  const first = (n: number, e: number): number => Math.max(0, Math.min(1, (n - e) / Math.max(1 - e, 1e-3)));
  ok(meanKeep(0) === 1 && steps < 0.05, `the mean keep over the noise is one at an erosion of nought and continuous in it (its largest step over 0.005 of erosion ${steps.toFixed(4)})`);
  ok(Math.abs(1 - meanKeep(0, first)) > 0.2, `the first version's formula, the raw noise at nought, is not (its mean keep at nought ${meanKeep(0, first).toFixed(3)}): the control`);
  let holes = 0;
  for (let b = 0; b < 256; b++) if (vol.histogram[b] && wispKeep(b / 255, ef + 0.2, ef) === 0) holes += vol.histogram[b];
  ok(holes > 0, `past erodeFull the cut opens holes: keep nought over ${((holes / (N * N * N)) * 100).toFixed(1)}% of the noise at ${(ef + 0.2).toFixed(2)}`);
  const mid = wispErosion(0.45, 1, 1, 0.5, 10, 1.5);
  const top = wispErosion(0.45, 2, 1, 0.5, 10, 1.5);
  const bottom = wispErosion(0.45, 0, 1, 0.5, 10, 1.5);
  ok(top > mid && bottom > mid && near(top, 0.45) && near(mid, 0.45 * 0.4), `stronger at a patch's top and bottom (${top.toFixed(3)}, ${bottom.toFixed(3)}) than at its mean (${mid.toFixed(3)})`);
  // keepColumn 1 holds the mean opacity: the mean of the kept density over the noise is one, within what the floor allows.
  // At the table's own erosions it is exact; between them the table is read linearly, as the march reads it, and holds the
  // mean within a few per cent.
  let held = true;
  let between = 0;
  for (let i = 0; i <= 150; i++) {
    const e = i / 150;
    const exact = i % 10 === 0;
    const mk = exact ? meanKeep(e) : expectedKeep(table, e);
    let sum0 = 0;
    let total0 = 0;
    for (let b = 0; b < 256; b++) {
      if (!vol.histogram[b]) continue;
      sum0 += vol.histogram[b] * wispDensity(1, b / 255, 0.45, e, ef, 1, 0.25, table);
      total0 += vol.histogram[b];
    }
    if (!exact) {
      const want0 = meanKeep(e) / Math.max(mk, 0.25);
      between = Math.max(between, Math.abs(sum0 / total0 - want0));
    }
  }
  for (let i = 0; i < KEEP_TABLE; i++) {
    const e = i / (KEEP_TABLE - 1);
    const mk = meanKeep(e);
    let sum = 0;
    let total = 0;
    for (let b = 0; b < 256; b++) {
      if (!vol.histogram[b]) continue;
      sum += vol.histogram[b] * wispDensity(1, b / 255, 0.45, e, ef, 1, 0.25, table);
      total += vol.histogram[b];
    }
    const want = mk >= 0.25 ? 1 : mk / 0.25;
    if (Math.abs(sum / total - want) > 1e-4) held = false;
  }
  ok(held, 'keepColumn 1 holds the mean kept density at one through the table at its own erosions, within the floor (where the mean keep is under keepFloor, keep over the floor)');
  ok(between < 1e-9, `and between them it divides by the table read linearly, as the march does (worst ${between.toExponential(1)} off that)`);
  ok(near(expectedKeep(table, 0), 1, 1e-6) && expectedKeep(table, 1) < expectedKeep(table, 0.1), 'the expected-keep table is one at nought and falls with erosion');
  // The march's own wispKeep and expectedKeep, run: their GLSL text turned into script and swept against the mirror
  // (wispDensity, expectedKeep) over the noise, the erosion past one, with and without keepColumn and at two floors. Pinned
  // by their text alone, a cut line or a table read could move with every suite green.
  const glsl = `${glslFunctionText(AIR_MARCH_SOURCE, 'expectedKeep')}\n${glslFunctionText(AIR_MARCH_SOURCE, 'wispKeep')}`;
  let runSame = true;
  let tableSame = true;
  let swept = 0;
  for (const [erode, column, floor] of [
    [0.45, 0, 0.25],
    [0.45, 1, 0.25],
    [0.8, 0.5, 0.4],
    [1.3, 1, 0.1],
  ]) {
    const uWispC = { x: erode, y: ef > 1e-3 ? ef : 1e-3, z: column, w: floor };
    const f = glslFunctions(glsl, ['wispKeep', 'expectedKeep'], { uWispC, uKeepTable: table });
    for (let e = 0; e <= 1.2001; e += 0.04) {
      if (Math.abs(f.expectedKeep(e) - expectedKeep(table, e)) > 1e-9) tableSame = false;
      for (let n = 0; n <= 1.0001; n += 1 / 32) {
        if (Math.abs(f.wispKeep(n, e) - wispDensity(1, n, erode, e, ef, column, floor, table)) > 1e-9) runSame = false;
        swept++;
      }
    }
  }
  ok(tableSame, "the march's expectedKeep, run, reads the table as the mirror does: linear between its sixteen entries, held to its ends");
  ok(runSame, `the march's wispKeep, run, is wispDensity's keep over ${swept} noises, erosions and settings (the cut, its bringing in over erodeFull, the column's division and its floor)`);
}

// --- the dust's blended backtrace: each patch on the air of the layers it stands in ---
{
  const S = AIR_TUNE.slabs;
  const wind = 6;
  const v = [
    { x: wind * S.windShare, z: 0 },
    { x: wind * S.windShare1, z: 0 },
    { x: wind * S.windShare2, z: 0 },
  ];
  const out = { x: 0, z: 0 };
  const ride = (mu: number, sigma: number): number => dustRideVelocity(1, mu, sigma, v, S.ceiling, S.ceiling1, out).x;
  ok(near(ride(0.3, 0.3), v[0].x, 0.01) && near(ride(6, 0.5), v[1].x, 0.02) && near(ride(14, 0.5), v[2].x, 0.01), `a patch at 0.3 m rides the low layer's wind (${ride(0.3, 0.3).toFixed(2)} m/s), one at 6 m the middle's (${ride(6, 0.5).toFixed(2)}), one at 14 m the high one's (${ride(14, 0.5).toFixed(2)})`);
  const shares: [number, number, number] = [0, 0, 0];
  let sum1 = true;
  for (const mu of [0, 0.3, 2, 3.5, 6, 9, 14, 30]) for (const sg of [0.1, 0.5, 2, 6]) {
    slabShares(mu, sg, S.ceiling, S.ceiling1, shares);
    if (!near(shares[0] + shares[1] + shares[2], 1, 1e-9)) sum1 = false;
  }
  ok(sum1 && near(dustRideVelocity(0, 9, 1, v, S.ceiling, S.ceiling1, out).x, ride(0, AIR_TUNE.dust.spreadMin), 1e-12), "the weights sum to one, and a texel with no dust rides the rest shape's air (the low layer's)");
  // Alike at 60 and 144 frames a second: a patch whose shape moves as it is carried -- a blast's dust thrown to 4.8 m,
  // falling, spreading and landing by the dust pass's own six laws (`dustShapeStep`, exact at any dt), its air read from
  // its shape before each step as the pass reads it -- carried ten seconds at each rate. Its ride slows as it falls from
  // the fast layers into the slow one, so the two rates agree only if the laws and the blend are taken alike.
  const travel = (fps: number): { x: number; v0: number; v1: number } => {
    const dt = 1 / fps;
    const law = newDustLaw();
    law.dt = dt;
    dustLawIn(law);
    const mu0 = 4.8;
    const sg0 = 1.6;
    const t: ShapeTexel = { d: 1, r: mu0, g: sg0 * sg0 + mu0 * mu0, b: 3, a: 0 };
    let x = 0;
    let v0 = Number.NaN;
    let v1 = 0;
    for (let f = 0; f < fps * 10; f++) {
      const mu = t.r / t.d;
      const sg = Math.sqrt(Math.max(t.g / t.d - mu * mu, law.min2));
      const u = dustRideVelocity(t.d, mu, sg, v, S.ceiling, S.ceiling1, out).x;
      if (f === 0) v0 = u;
      v1 = u;
      x += u * dt;
      dustShapeStep(t, law);
    }
    return { x, v0, v1 };
  };
  const t60 = travel(60);
  const t144 = travel(144);
  ok(Math.abs(t60.v0 - t60.v1) > 1e-3, `a blast's dust thrown to 4.8 m rides the layers it stands in, its air moving as it falls (${t60.v0.toFixed(2)} m/s at first, ${t60.v1.toFixed(2)} m/s ten seconds on): the carry below is not a constant's`);
  ok(Math.abs(t60.x - t144.x) < 0.01 * t144.x, `and is carried alike at 60 and 144 frames a second (${t60.x.toFixed(2)} and ${t144.x.toFixed(2)} m in ten seconds)`);
  ok(DUST_FRAGMENT.includes('float w0 = slabShare(0, m0, g0);') && DUST_FRAGMENT.includes('v = (va * w0 + vb * w1 + vc * w2) / max(ws, 1e-6);'), "the dust pass's line is the mirror's: each slab's air by the patch's share in it, read before the backtrace");
  // An empty texel takes the shape of the dust about to flow into it: inside a low building's column slab 0 stands still
  // and slab 1 flows over, so a patch at 5 m crossing into it rides slab 1's air in; read off the texel's own rest shape it
  // rode slab 0's nought and never entered (the third wave's smoke check, no dust ever over a roof).
  const blocked = [{ x: 0, z: 0 }, v[1], v[2]];
  const inFrom = dustRideVelocity(0, 0, 0, blocked, S.ceiling, S.ceiling1, out, AIR_TUNE.dust.spreadMin, { d: 1, mu: 5, sigma: 1 }).x;
  const before = dustRideVelocity(0, 0, 0, blocked, S.ceiling, S.ceiling1, { x: 0, z: 0 }).x;
  ok(inFrom > 0.8 * v[1].x && before < 0.05 * v[1].x, `an empty texel in a low building's column rides in the high patch's air (${inFrom.toFixed(2)} m/s), where read off its own rest shape it rode the ground's nought (${before.toFixed(2)})`);
  ok(DUST_FRAGMENT.includes('if (D0 < 1e-5) {') && DUST_FRAGMENT.includes('vec2 pb = l - (va + vb + vc) * (uDt / (3.0 * uWindow.z)) + uDustShift;') && DUST_FRAGMENT.includes('d0 = dustAt(0, pb);'), "the dust pass reads an empty texel's shape where the slabs' mean air brings it from");
}

// --- the bands are the noise read at the light's four heights ---
{
  // Still air: the flow nought, so the bands' four heights and the march's noise mode read the very same coordinates.
  ok(BANDS_FRAGMENT.includes('vec3 q = vec3(w.x, hy * uWispA.y, w.y) * uWispA.x;') && AIR_MARCH_SOURCE.includes('vec3 c = vec3(p.x, hy * uWispA.y, p.z) * uWispA.x;'), 'the bands and the march put a sample at the same place in the noise: across by the scale, up by the height over the ground times the stretch');
  ok(BANDS_FRAGMENT.includes('float n1 = textureLod(uNoise3, q - flow * uWispB.y * uWispA.x + 0.37, 0.0).r;') && AIR_MARCH_SOURCE.includes('textureLod(uNoise3, c - flow * uWispB.y * uWispA.x + 0.37, lod).r'), 'and offset phase one alike');
  ok(BANDS_FRAGMENT.includes('float n0 = textureLod(uNoise3, q - flow * uWispB.x * uWispA.x, 0.0).r;') && AIR_MARCH_SOURCE.includes('float n = mix(textureLod(uNoise3, c - flow * uWispB.x * uWispA.x, lod).r,') && BANDS_FRAGMENT.includes('o[b] = mix(n0, n1, uWispB.z);'), 'phase zero read alike and the two mixed by the same weight: in still air the bands at the four heights are the noise the march reads there');
  ok(BANDS_FRAGMENT.includes('vec4 o;\n  for (int b = 0; b < 4; b++) {\n    float hy = uLightH[b];') && AIR_MARCH_SOURCE.includes('return lightTau(textureLod(uBands, q, 0.0), hy);'), "the bands are written at the light's four heights and the march interpolates them by its sample's height, the light's own way");
}

// --- the height-aware kill over a solid ---
{
  const top = 3;
  const share = (mu: number, sigma: number): { share: number; mean: number } => aboveSolid(mu, sigma, top, { share: 0, mean: 0 });
  // The numeric integral of the folded profile above the roof: its mass, its mean height and its spread squared.
  const integral = (mu: number, sigma: number): { share: number; mean: number; spread2: number } => {
    let m = 0;
    let mh = 0;
    let mh2 = 0;
    const n = 200_000;
    const hi = Math.max(mu + 12 * sigma, top + 12 * sigma);
    for (let i = 0; i < n; i++) {
      const h = top + ((i + 0.5) / n) * (hi - top);
      const f = foldedProfile(h, mu, sigma) * ((hi - top) / n);
      m += f;
      mh += f * h;
      mh2 += f * h * h;
    }
    const mean = m > 0 ? mh / m : 0;
    return { share: m, mean, spread2: m > 0 ? mh2 / m - mean * mean : 0 };
  };
  const low = share(0.3, 0.25);
  const high = share(6, 1);
  const half = share(3, 1);
  ok(low.share < 1e-6, `over a ${top} m roof a patch at 0.3 m is gone (${low.share.toExponential(1)} kept)`);
  ok(high.share > 0.99, `one at 6 m keeps nearly all of itself (${high.share.toFixed(4)})`);
  ok(Math.abs(half.share - 0.5) < 0.05, `one at 3 m about half (${half.share.toFixed(3)})`);
  let worst = 0;
  let worstSpread = 0;
  for (const [mu, sg] of [
    [0.3, 0.25],
    [3, 1],
    [6, 1],
    [4.8, 1.6],
    [2, 0.4],
  ]) {
    const a = aboveSolid(mu, sg, top, { share: 0, mean: 0, spread2: 0 });
    const b = integral(mu, sg);
    if (b.share > 1e-6) {
      worst = Math.max(worst, Math.abs(a.share - b.share), Math.abs(a.mean - b.mean) / Math.max(1, b.mean));
      worstSpread = Math.max(worstSpread, Math.abs((a.spread2 ?? 0) - b.spread2) / Math.max(1, b.spread2));
    }
  }
  ok(worst < 2e-3, `its share and lifted mean are the folded profile's own integral above the roof (worst ${worst.toExponential(1)})`);
  ok(worstSpread < 2e-3, `and its spread is that share's own, the integral's (worst ${worstSpread.toExponential(1)}), never the patch's held`);
  ok(aboveSolid(2, 1, 0, { share: 0, mean: 0 }).share === 1 && aboveSolid(2, 1, 0, { share: 0, mean: 0 }).mean === 2, 'a solid of top nought keeps the patch as it is');
  ok(DUST_FRAGMENT.includes('float m = clamp(qa + qb, 0.0, 1.0);') && DUST_FRAGMENT.includes('m2 = max(lifted, 0.0);') && DUST_FRAGMENT.includes('s2 = max(second - lifted * lifted, uMin2);') && !DUST_FRAGMENT.includes('if (texture(uObstacles, l).r > uObstacleOver) {\n    oDust = vec4(0.0);'), "the dust pass's kill is the mirror's (never makes mass, the share's own spread), and the column kill is gone");
  // A patch lying over a roof in still air, cut again at every step for ten seconds at 60 and at 144 a second with the
  // dust's own fall and spread growth between cuts: it settles just over the roof and dies away, never climbing (the third
  // wave's smoke found the spread held lifting it 19 km in six seconds), and alike at both rates.
  const sit = (rate: number, held = false): { mean: number; mass: number; most: number } => {
    const dt = 1 / rate;
    let m = 1;
    let mean = 4.8;
    let s2 = 1.6 * 1.6;
    let most = mean;
    const minS = AIR_TUNE.dust.spreadMin * AIR_TUNE.dust.spreadMin;
    const k = { share: 0, mean: 0, spread2: 0 };
    for (let i = 0; i < rate * 10; i++) {
      mean = Math.max(0, mean - AIR_TUNE.dust.fall * dt);
      s2 = Math.min(s2 + 0.05 * dt, 16);
      aboveSolid(mean, Math.sqrt(s2), top, k);
      m *= k.share;
      mean = k.mean;
      if (!held) s2 = Math.max(k.spread2 ?? 0, minS);
      if (mean > most) most = mean;
    }
    return { mean, mass: m, most };
  };
  const s60 = sit(60);
  const s144 = sit(144);
  ok(s60.most < top + 4 && s144.most < top + 4 && Number.isFinite(s60.mean) && Number.isFinite(s144.mean), `a patch over a ${top} m roof for ten seconds rises no higher than ${Math.max(s60.most, s144.most).toFixed(2)} m (60 and 144 a second) and stays finite`);
  ok(s60.mass < 0.5 && s144.mass < 0.5, `and is mostly gone by then (${(s60.mass * 100).toFixed(1)}% and ${(s144.mass * 100).toFixed(1)}% left), as dust settling onto a roof is`);
  const heldRun = sit(60, true);
  ok(heldRun.most > s60.most + 2, `the control: with the patch's spread held at every cut (the first cut's rule) the same patch climbs to ${heldRun.most.toFixed(1)} m in float64 (in float32 on the card, where its moments then lost the spread, without end)`);
  // A blast's dust drifting over a building: a row of cells, the building's five in the middle, the patch carried one cell
  // a step and the kill applied in every solid cell; downwind of the building dust remains. The control is the dust pass
  // as it stood before this wave (wave 2b's, read out of git): its obstacle branch wrote nought for the whole texel.
  const was = execFileSync('git', ['-C', REPO, 'show', `${PRE_WAVE}:src/world/volumetrics/airShaders.ts`], { encoding: 'utf8', maxBuffer: 1 << 28 }).replace(/\r\n/g, '\n');
  const oldDust = was.slice(was.indexOf('export const DUST_FRAGMENT'), was.indexOf('`;', was.indexOf('export const DUST_FRAGMENT')));
  const columnKill = /if \(texture\(uObstacles, l\)\.r > uObstacleOver\) \{\n\s+oDust = vec4\(0\.0\);\n\s+oShape = vec4\(0\.0\);\n\s+return;/.test(oldDust);
  ok(oldDust.length > 1000 && columnKill, `the dust pass before this wave (${PRE_WAVE}) wrote nought for any texel inside a solid, whatever height its dust stood at: the column kill`);
  const cells = 40;
  let mass = 1;
  let mu = 4.8;
  const sigma = 1.6;
  let colMass = 1;
  for (let c = 0; c < cells; c++) {
    const solid = c >= 15 && c < 20;
    if (solid) {
      const k = aboveSolid(mu, sigma, top, { share: 0, mean: 0 });
      mass *= k.share;
      mu = k.mean;
      // The old pass's rule, as its text above says: a solid texel keeps nothing.
      if (columnKill) colMass = 0;
    }
  }
  ok(mass > 0.3 && colMass === 0, `a blast's dust at 4.8 m drifting over a ${top} m building keeps ${(mass * 100).toFixed(0)}% of itself downwind of it, where the old column kill left none: no clean wake`);
}

// --- a dust field a layer (Ultra's): each tile carried by its own slab's air, its splats shared by their shape ---
{
  ok(DUST_FRAGMENT.includes('if (tiles > 1.5) v = slabVelAt(uVel, lq, k, uWind);'), "with a field a layer each tile's dust rides its own slab's air, never slab 0's for all three");
  ok(DUST_FRAGMENT.includes('int k = tiles > 1.5 ? int(clamp(floor(vUv.x * tiles), 0.0, tiles - 1.0)) : 0;') && DUST_FRAGMENT.includes('vec2 l = tiles > 1.5 ? vec2(vUv.x * tiles - float(k), vUv.y) : vUv;'), 'the pass tells its tile from its place across the pair and works in that tile\'s own uv');
  ok(DUST_FRAGMENT.includes('if (tiles > 1.5) a *= slabShare(k, sh.x, sh.y);') && DUST_FRAGMENT.includes('if (tiles > 1.5) st *= slabShare(k, 0.0, sqrt(max(uStormSigma2, 1e-6)));'), "a splat and the storm's shedding are shared into the tiles by how much of each one's profile stands in that tile's slab");
  ok(DUST_FRAGMENT.includes('float sh = uDustR.x > 1.5 ? slabShare(k, 0.0, sqrt(max(uStormSigma2, 1e-6))) : 1.0;'), "and the storm outside the window comes in to each tile by its own share");
  // The shares a splat is laid by, the mirror's: summed over the tiles they are the whole of it, so a field a layer lays
  // exactly the dust one field would.
  const S = AIR_TUNE.slabs;
  const sh: [number, number, number] = [0, 0, 0];
  let whole = true;
  for (const mu of [0.2, 1.5, 4.8, 9, 14]) for (const sg of [0.25, 1, 3]) {
    slabShares(mu, sg, S.ceiling, S.ceiling1, sh);
    if (!near(sh[0] + sh[1] + sh[2], 1, 1e-9) || sh.some((x) => x < 0)) whole = false;
  }
  ok(whole, 'and the three shares of any splat are the whole of it: a field a layer lays what one field lays');
  ok(source('core/fx/airVolume.ts').includes('ar.y = src.dustTiles.value.x;') && AIR_MARCH_SOURCE.includes('if (float(k) >= uAirR.y) break;'), 'the march reads as many tiles as the field says it has (`dustTiles`)');
}

console.log(`\n${checks} checks passed`);
