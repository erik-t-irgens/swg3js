// The light pass toward the sun (src/world/volumetrics/airLight.ts and `LIGHT_FRAGMENT`), from wave 2b at the
// dust's own height: its step still the handoff's demo's (`land.html:640-664`: 0.64 · min(3.5, 0.75 / tan elevation),
// lengthened with fewer steps so the reach in metres holds), and the optical depth at its four heights over a level
// layer held to the march's own extinction (`0.55 · D · H₀ · ∫ f dy / sin el`, the folded profile's integral by erf) at a
// sun of 67.5° and of 30° (research-amend-dust §2.2's two suns); a self-shadow of nought a transmittance of one; past the
// steps' reach the storm's tail in closed form; the march's reading between the heights; a half float holding τ to its
// own step. And the shader's text is the same march, at every one of those points.
//
// Plain type stripping.
import assert from 'node:assert/strict';
import { lightDepthAt, lightDepthAtHeight, lightElevation, lightMarchFor, lightMarchIn, lightReach, lightSunAcross, type LightMarch, type LightMarchAsk, type LightSample } from '../../../src/world/volumetrics/airLight.ts';
import { erfApprox, foldedProfile, HALF_NORMAL, lightStep } from '../../../src/world/volumetrics/airMath.ts';
import { AIR_TUNE } from '../../../src/world/volumetrics/airTune.ts';
import { AIR_ERF_GLSL, AIR_PROFILE_GLSL, LIGHT_FRAGMENT, MAX_LIGHT_STEPS } from '../../../src/world/volumetrics/airShaders.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;
const deg = (d: number): number => (d * Math.PI) / 180;

// --- the step, the demo's ---
const demoStep = (el: number): number => 0.64 * Math.min(3.5, 0.75 / Math.tan(el));
ok(near(lightStep(deg(41), 26), demoStep(deg(41))), `at 41°, a step of ${demoStep(deg(41)).toFixed(3)} m, the demo's`);
ok(near(lightStep(deg(12), 26), demoStep(deg(12))) && near(demoStep(deg(12)), 0.64 * 3.5), `at 12°, ${demoStep(deg(12)).toFixed(3)} m: the low sun's step held at its cap`);
ok(near(lightReach(deg(41), 26), demoStep(deg(41)) * 26), `the reach toward a sun at 41° is ${(demoStep(deg(41)) * 26).toFixed(1)} m across the ground`);
for (const steps of [12, 16, 20, 32, 40]) ok(near(lightReach(deg(41), steps), lightReach(deg(41), 26), 1e-9), `${steps} steps reach as far as 26: each is longer by 26 / ${steps}`);
ok(lightStep(deg(-10), 26) === lightStep(0.05, 26), 'a sun under the horizon is taken at its least height, never a negative step');
ok(!('k' in AIR_TUNE.light) && !('dust' in AIR_TUNE.light), "the first wave's per-step k and dust share are gone: how strongly the dust shades itself is the page's self-shadow");
ok(AIR_TUNE.light.h0 === 0 && AIR_TUNE.light.h1 === 2 && AIR_TUNE.light.h2 === 5 && AIR_TUNE.light.h3 === 10, 'the four heights start at 0, 2, 5 and 10 m');

// --- the four heights through a level layer, against the march's own extinction ---
const H0 = AIR_TUNE.dust.height;
const E = AIR_TUNE.dust.extinction;
/** ∫_a^b of the folded profile, by erf: the half of each image inside [a, b]. */
const profileIntegral = (a: number, b: number, mu: number, sigma: number): number => {
  const lo = Math.max(0, a);
  const k = 1 / (Math.SQRT2 * sigma);
  return 0.5 * (erfApprox((b - mu) * k) - erfApprox((lo - mu) * k) + erfApprox((b + mu) * k) - erfApprox((lo + mu) * k));
};
const march = (el: number, steps: number, selfShadow = 1, inflow = 0, stormSigma = 1): LightMarch => {
  const m: LightMarch = { sunX: 1, sunZ: 0, step: 0, slant: 0, rise: 0, steps, k: selfShadow * E * H0, inflow, stormSigma, invSin: 0, size: AIR_TUNE.window.size, heights: [0, 2, 5, 10] };
  return lightMarchFor(el, steps, m);
};
const layers: { name: string; D: number; mu: number; sigma: number }[] = [
  { name: 'the first wave\'s calm column as a half-normal (D 1)', D: 1, mu: 0, sigma: HALF_NORMAL * H0 },
  { name: 'a fresh lift at 0.3 ± 0.25 m (D 1)', D: 1, mu: 0.3, sigma: 0.25 },
  { name: 'a risen lift at 1.9 ± 0.9 m (D 2)', D: 2, mu: 1.9, sigma: 0.9 },
];
for (const sun of [67.5, 30]) {
  const el = deg(sun);
  for (const L of layers) {
    const level = (_u: number, _v: number, s: LightSample): void => {
      s.d = L.D;
      s.mu = L.mu;
      s.sigma = L.sigma;
      s.ground = 0;
    };
    const fine = march(el, 600);
    const coarse = march(el, 26);
    const got = lightDepthAt(level, 0.5, 0.5, fine, [0, 0, 0, 0]);
    const at26 = lightDepthAt(level, 0.5, 0.5, coarse, [0, 0, 0, 0]);
    let fineOk = true;
    let coarseWorst = 0;
    const want: number[] = [];
    for (let j = 0; j < 4; j++) {
      const h = fine.heights[j];
      const w = (E * L.D * H0 * profileIntegral(h, h + fine.steps * fine.rise, L.mu, L.sigma)) / Math.sin(el);
      want.push(w);
      if (Math.abs(got[j] - w) > 2e-3 * Math.max(w, 1e-3) + 1e-6) fineOk = false;
      coarseWorst = Math.max(coarseWorst, Math.abs(at26[j] - w) / Math.max(w, 1e-2));
    }
    ok(fineOk, `${L.name}, a sun at ${sun}°: the optical depth at 0, 2, 5 and 10 m is the march's own extinction (${want.map((w) => w.toFixed(3)).join(', ')}), within 0.2% stepped finely`);
    // The demo's 26 steps rise 0.48 m a step whatever the sun: a layer a quarter metre thick is sampled twice per its
    // spread, which the midpoint rule still holds within a few per cent.
    ok(coarseWorst < 0.08, `and at the pass's own 26 steps within ${(coarseWorst * 100).toFixed(1)}% (${at26.map((t) => t.toFixed(3)).join(', ')})`);
  }
}
{
  const el = deg(67.5);
  const level = (_u: number, _v: number, s: LightSample): void => {
    s.d = 1;
    s.mu = 0.3;
    s.sigma = 0.25;
    s.ground = 0;
  };
  const τ = lightDepthAt(level, 0.5, 0.5, march(el, 26), [0, 0, 0, 0]);
  ok(τ[0] > τ[1] && τ[1] > τ[2] && τ[2] >= τ[3], `dust above dust is lit: the depth toward the sun falls with height (${τ.map((t) => t.toFixed(3)).join(', ')}), where the first wave gave one number at any height`);
  const none = lightDepthAt(level, 0.5, 0.5, march(el, 26, 0), [1, 1, 1, 1]);
  ok(none.every((t) => t === 0), 'a self-shadow of nought: an optical depth of nought, a transmittance of one');
}

// --- past the steps' reach, the storm's tail in closed form ---
{
  const el = deg(40);
  const sigma = HALF_NORMAL * AIR_TUNE.dust.stormHeight;
  const m = march(el, 26, 1, 0.8, sigma);
  // A point on the window's sunward edge: every step is out of the window, the storm's dust standing on its ground.
  const out = lightDepthAt(() => {}, 0.9999, 0.5, m, [0, 0, 0, 0]);
  let tail = true;
  for (let j = 0; j < 4; j++) {
    const h = m.heights[j];
    const want = (E * H0 * 0.8 * (1 - erfApprox(h / (Math.SQRT2 * sigma)))) / Math.sin(el);
    if (Math.abs(out[j] - want) > 0.01 * want) tail = false;
  }
  ok(tail, `the storm's tall inflow, stepped then finished past the reach by the half-normal's tail, is its whole column above each height along the slant (${out.map((t) => t.toFixed(3)).join(', ')})`);
}

// --- the march reads between the heights ---
{
  const τ = [1.2, 0.6, 0.2, 0.05];
  const h = [0, 2, 5, 10];
  ok(lightDepthAtHeight(τ, h, -1) === 1.2 && lightDepthAtHeight(τ, h, 0) === 1.2 && near(lightDepthAtHeight(τ, h, 1), 0.9) && near(lightDepthAtHeight(τ, h, 3.5), 0.4) && near(lightDepthAtHeight(τ, h, 7.5), 0.125) && lightDepthAtHeight(τ, h, 40) === 0.05, 'between the heights the depth is piecewise linear, held at the lowest below it and the highest above');
}

// --- a half float holds τ to its own step ---
{
  const f32 = new Float32Array(1);
  const u32 = new Uint32Array(f32.buffer);
  /** A half float rounded to nearest, as a render target is written. */
  const half = (x: number): number => {
    f32[0] = x;
    const b = u32[0];
    const exp = ((b >>> 23) & 0xff) - 127;
    if (exp < -14) return 0;
    const step = 2 ** (exp - 10);
    return Math.round(x / step) * step;
  };
  let worst = 0;
  let worstT = 0;
  for (let τ = 0.001; τ < 20; τ *= 1.07) {
    worst = Math.max(worst, Math.abs(half(τ) - τ) / τ);
    worstT = Math.max(worstT, Math.abs(Math.exp(-half(τ)) - Math.exp(-τ)));
  }
  ok(worst <= 2 ** -11 + 1e-12 && worstT < 1e-3, `a half float holds a depth to its own step (${(worst * 100).toFixed(3)}% at worst) and the transmittance to ${worstT.toExponential(2)}`);
}

// --- the sun across the ground ---
{
  const out = { x: 0, z: 0 };
  lightSunAcross(3, 4, out);
  ok(near(out.x, 0.6) && near(out.z, 0.8), 'the sun across the ground is its direction in XZ made unit');
  lightSunAcross(0, 0, out);
  ok(out.x === 0 && out.z === 1, 'straight overhead reads +Z, a direction and never a NaN');
  ok(near(lightElevation(Math.sin(deg(41))), deg(41)) && lightElevation(2) === Math.PI / 2, 'the elevation from the up part, held to a quarter turn');
  const m = march(deg(35), 26);
  ok(near(m.slant, m.step / Math.cos(deg(35))) && near(m.rise, m.step * Math.tan(deg(35))) && near(m.invSin, 1 / Math.sin(deg(35))), "the march's slant, rise and the slant a metre of height is, from the step and the elevation");
  // The field's own form (the elevation in the record, so no number crosses the call on the frame) is the same to the bit.
  let same = true;
  for (const elDeg of [0, 2, 10, 35, 67.5, 89]) {
    for (const steps of [8, 26, 40]) {
      const a = lightMarchFor(deg(elDeg), steps, { ...m });
      const b: LightMarchAsk = { ...m, elevation: deg(elDeg), steps };
      lightMarchIn(b);
      if (!Object.is(a.step, b.step) || !Object.is(a.slant, b.slant) || !Object.is(a.rise, b.rise) || !Object.is(a.invSin, b.invSin)) same = false;
    }
  }
  ok(same, "lightMarchIn (the field's frame form) is lightMarchFor to the bit, from the sun on the horizon to overhead");
}

// --- the shader is the same march ---
{
  const L = LIGHT_FRAGMENT;
  ok(L.includes('vec2 stepUv = uSunDir * uStep / uWindow.z;') && L.includes('float x = float(k) - 0.5;') && L.includes('vec2 q = vUv + stepUv * x;'), 'the shader steps toward the sun from the texel, each step at its middle, in window uv');
  ok(L.includes('d = uInflow;') && L.includes('sigma = uStormSigma;') && L.includes('g = g0;'), "out of the window the storm's dust, standing on the texel's own ground");
  ok(L.includes('mu = s.r / d;') && L.includes('sigma = sqrt(max(s.g / d - mu * mu, uSpreadMin * uSpreadMin));') && L.includes('if (d >= 1e-5) {'), 'inside it the carried shape, a trace reading the rest shape');
  ok(L.includes('sum += d * profile4(uLightH + vec4(x * uRise - (g - g0)), mu, sigma);') && L.includes('vec4 tau = uK * sum * uSlant;'), "the four heights' folded profile, the ground's rise taken off, summed along the slant");
  ok(L.includes('tau += uK * uInflow * uInvSin * (vec4(1.0) - vec4(airErf(hEnd.x * r), airErf(hEnd.y * r), airErf(hEnd.z * r), airErf(hEnd.w * r)));'), "past the reach the storm's tail by erf");
  ok(L.includes('gl_FragColor = finite4(max(tau, vec4(0.0)));') && !L.includes('exp(-uK'), 'written as optical depths, never a transmittance: the march takes exp(−τ) itself');
  ok(L.includes(`for (int k = 1; k <= ${MAX_LIGHT_STEPS}; k++)`) && L.includes('if (k > uSteps) break;') && MAX_LIGHT_STEPS >= 40, 'its steps a uniform under a fixed bound that every setting fits, so the steps dial builds no program');
  ok((L.match(/texture\(/g) ?? []).length === 4, 'and a step reads the dust, its shape and the ground (the texel\'s own ground once, before the loop)');
  // The two shared functions' bodies, run: each GLSL text turned into script word for word (a `float` declaration a `let`,
  // a built-in its Math namesake) and evaluated against its mirror over a sweep. Pinning a signature alone let a body
  // lose the ground's mirror image or erf its square with every suite green, and nothing in the browser sees the erf
  // (the light's self test runs with no storm, and the march has none).
  const asScript = (glsl: string, name: string): ((...a: number[]) => number) => {
    const body = glsl
      .replace(/float\s+(\w+)\s*\(([^)]*)\)\s*\{/, (_m, fn: string, params: string) => `function ${fn}(${params.replace(/\bfloat\s+/g, '')}) {`)
      .replace(/\bfloat\s+/g, 'let ')
      .replace(/\b(exp|abs|max|min|sqrt)\(/g, 'Math.$1(');
    return new Function(`${body}\nreturn ${name};`)() as (...a: number[]) => number;
  };
  ok(L.includes(AIR_PROFILE_GLSL.trim()) && L.includes(AIR_ERF_GLSL.trim()), 'the light pass interpolates the shared profile and erf, never a copy of its own');
  const airErf = asScript(AIR_ERF_GLSL, 'airErf');
  const airProfile = asScript(AIR_PROFILE_GLSL, 'airProfile');
  let erfSame = true;
  for (let x = -4; x <= 4; x += 0.0625) if (Math.abs(airErf(x) - erfApprox(x)) > 1e-12) erfSame = false;
  let profileSame = true;
  let sampled = 0;
  for (const sigma of [0.00005, 0.05, 0.25, 1, 3.7, 9]) {
    for (const mu of [0, 0.3, 1.7, 6, 15]) {
      for (let h = -1; h <= 30; h += 0.37) {
        const a = airProfile(h, mu, sigma);
        const b = foldedProfile(h, mu, sigma);
        if (Math.abs(a - b) > 1e-12 * Math.max(1, Math.abs(b))) profileSame = false;
        sampled++;
      }
    }
  }
  ok(erfSame, "airErf's body, run, is erfApprox's to 1e-12 from −4 to 4 (the coefficients and the exp(−a·a) term alike)");
  ok(profileSame && foldedProfile(0.5, 0.3, 0.25) > 0, `airProfile's body, run, is foldedProfile's over ${sampled} heights, means and spreads (both Gaussians, the floor on the spread, nought under the ground, 1/sqrt(2π) over σ)`);
}

console.log(`\n${checks} checks passed`);
