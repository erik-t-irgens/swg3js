// The light pass toward the sun (src/world/volumetrics/airLight.ts and `LIGHT_FRAGMENT`): its march mirrored and held to
// the handoff's demo (`land.html:640-664`): the step 0.64 · min(3.5, 0.75 / tan elevation), the sun's reach at 41° and
// 12°, the coefficients (a unit of dust takes 0.55, the transmittance exp(-0.16 · sum)), out of the window the storm's
// dust, and the step lengthened with fewer steps so the reach in metres holds. And the shader's text is the same march.
//
// Plain type stripping.
import assert from 'node:assert/strict';
import { lightElevation, lightReach, lightSunAcross, marchLight, type LightMarch } from '../../../src/world/volumetrics/airLight.ts';
import { lightStep, lightTransmittance } from '../../../src/world/volumetrics/airMath.ts';
import { AIR_TUNE } from '../../../src/world/volumetrics/airTune.ts';
import { LIGHT_FRAGMENT, MAX_LIGHT_STEPS } from '../../../src/world/volumetrics/airShaders.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;
const deg = (d: number): number => (d * Math.PI) / 180;

// The demo's numbers, written out: 26 steps.
const demoStep = (el: number): number => 0.64 * Math.min(3.5, 0.75 / Math.tan(el));
ok(near(lightStep(deg(41), 26), demoStep(deg(41))), `at 41°, a step of ${demoStep(deg(41)).toFixed(3)} m, the demo's`);
ok(near(lightStep(deg(12), 26), demoStep(deg(12))) && near(demoStep(deg(12)), 0.64 * 3.5), `at 12°, ${demoStep(deg(12)).toFixed(3)} m: the low sun's step held at its cap`);
ok(near(lightReach(deg(41), 26), demoStep(deg(41)) * 26), `the reach toward a sun at 41° is ${(demoStep(deg(41)) * 26).toFixed(1)} m across the ground`);
ok(near(lightReach(deg(12), 26), 0.64 * 3.5 * 26), `and toward one at 12° ${(0.64 * 3.5 * 26).toFixed(1)} m`);
for (const steps of [12, 16, 20, 32, 40]) ok(near(lightReach(deg(41), steps), lightReach(deg(41), 26), 1e-9), `${steps} steps reach as far as 26: each is longer by 26 / ${steps}`);
ok(lightStep(deg(-10), 26) === lightStep(0.05, 26), 'a sun under the horizon is taken at its least height, never a negative step');
ok(AIR_TUNE.light.dust === 0.55 && AIR_TUNE.light.k === 0.16, "the coefficients are the demo's: 0.55 a unit of dust, exp(-0.16 · sum)");

// The march over even dust and over a wall of it.
const m: LightMarch = { sunX: 1, sunZ: 0, step: lightStep(deg(35), 26), steps: 26, dustK: AIR_TUNE.light.dust, k: AIR_TUNE.light.k, inflow: 0, size: AIR_TUNE.window.size };
ok(near(marchLight(() => 0.5, 0.5, 0.5, m), lightTransmittance(26 * 0.5 * 0.55)), 'over even dust: exp(-k · steps · dust · 0.55)');
ok(marchLight(() => 0, 0.5, 0.5, m) === 1, 'over clear air: one');
const wall = (u: number): number => (u > 0.52 && u < 0.56 ? 2 : 0);
const lit = marchLight((u) => wall(u), 0.58, 0.5, m);
const shaded = marchLight((u) => wall(u), 0.5, 0.5, m);
ok(lit === 1 && shaded < 0.7, `a point beyond a wall of dust from the sun is lit (${lit}), one with the wall between it and the sun is dark (${shaded.toFixed(3)}): the lit face and the dark heart`);
const edge = marchLight(() => 0, 0.995, 0.5, { ...m, inflow: 0.5 });
ok(edge < 1 && edge > lightTransmittance(26 * 0.5 * 0.55) - 1e-9, "out of the window the storm's dust is on the way");

// The sun across the ground.
{
  const out = { x: 0, z: 0 };
  lightSunAcross(3, 4, out);
  ok(near(out.x, 0.6) && near(out.z, 0.8), 'the sun across the ground is its direction in XZ made unit');
  lightSunAcross(0, 0, out);
  ok(out.x === 0 && out.z === 1, 'straight overhead reads +Z, a direction and never a NaN');
  ok(near(lightElevation(Math.sin(deg(41))), deg(41)) && lightElevation(2) === Math.PI / 2, 'the elevation from the up part, held to a quarter turn');
}

// The shader is the same march.
ok(LIGHT_FRAGMENT.includes('vec2 stepUv = uSunDir * uStep / uWindow.z;') && LIGHT_FRAGMENT.includes('vec2 q = vUv + stepUv * float(k);'), 'the shader steps toward the sun from the texel, a step in window uv');
ok(LIGHT_FRAGMENT.includes('? uInflow : texture(uDust, q).a') && LIGHT_FRAGMENT.includes('sum += d * uDustK;') && LIGHT_FRAGMENT.includes('exp(-uK * sum)'), "out of the window the inflow, the dust's share summed, exp(-k · sum)");
ok(LIGHT_FRAGMENT.includes(`for (int k = 1; k <= ${MAX_LIGHT_STEPS}; k++)`) && LIGHT_FRAGMENT.includes('if (k > uSteps) break;') && MAX_LIGHT_STEPS >= 40, 'its steps a uniform under a fixed bound that every setting fits, so the steps dial builds no program');
ok((LIGHT_FRAGMENT.match(/texture\(/g) ?? []).length === 1, 'and one sample a step');

console.log(`\n${checks} checks passed`);
