// The volume over the moving air (src/core/fx/airVolume.ts), built in node under plain type stripping (it imports only
// `.ts`-suffixed modules and nothing of the clouds'): it refuses with a reason for an amount of 0, in space, with the
// player in a building, with the camera in a building's view, under water, with no field and with nothing airborne, and
// draws with only the camera in a hull (whose box is kept clear of dust inside the march); it lists its three materials;
// its target is its setting's share of the screen, and no resize disposes a material; the cascade sampler is never null
// and no shadow compare is in a vertex stage; the light pass is sampled once a step; and the chain resizes it in
// `configure` (read as text: the chain itself is the browser's).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { AIR_VOLUME_FRAGMENTS, AirVolumePass, MAX_VOLUME_STEPS } from '../../../src/core/fx/airVolume.ts';
import { createContext } from '../../../src/core/fx/context.ts';
import { FX_DEFAULTS, FX_PASSES, fxPassWanted, type FxSettings } from '../../../src/core/fxRegistry.ts';
import { FX_FULLSCREEN_VERTEX } from '../../../src/core/fx/glsl.ts';
import type { AirSource } from '../../../src/world/volumetrics/airField.ts';
import { farHalfNormalDepth, foldedProfile, nearFade } from '../../../src/world/volumetrics/airMath.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const here = dirname(fileURLToPath(import.meta.url));
const source = (p: string): string => readFileSync(join(here, '..', '..', '..', 'src', p), 'utf8');
const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;

/** A stand-in air: what the volume reads, with dust in the air and carried this frame unless told otherwise. */
function air(airborne = true, dust: THREE.Texture | null = new THREE.Texture(), dustLive = true): AirSource {
  return {
    dustLive,
    dust: { value: dust },
    shape: { value: new THREE.Texture() },
    lightHeights: { value: new THREE.Vector4(0, 2, 5, 10) },
    look: { value: new THREE.Vector4(0.6, 0, 7.2, 0.15) },
    bandTop: 7.2,
    light: { value: new THREE.Texture() },
    height: { value: new THREE.Texture() },
    obstacles: { value: new THREE.Texture() },
    window: { value: new THREE.Vector4(0, 0, 192, 1.5) },
    lightShift: { value: new THREE.Vector2() },
    band: { value: new THREE.Vector3() },
    inflow: { value: new THREE.Vector2(0, 1.8) },
    stormColour: { value: new THREE.Color() },
    lightOn: { value: 1 },
    hullInverse: { value: new THREE.Matrix4() },
    hullBox: { value: new THREE.Vector4() },
    hasAir: () => airborne,
    volumeDrew: false,
    debugTexture: () => null,
  };
}
const target = new THREE.WebGLRenderTarget(4, 4, { depthTexture: new THREE.DepthTexture(4, 4) });
const ctx = createContext({} as THREE.WebGLRenderer, { ...FX_DEFAULTS }, target);
const on: FxSettings = { ...FX_DEFAULTS, volumetrics: true, airVolume: true, airVolumeAmount: 1 };
let src: AirSource | null = air();
const pass = new AirVolumePass(() => src);
pass.setSize(1600, 900, on);

const why = (): string | null => pass.reason(ctx);
ok(why() === null && pass.enabled(ctx), 'with the master on, a field, dust in the air and the camera outdoors, it draws');
ctx.cameraInHull = true;
ok(why() === null, 'and with the camera inside the hull it rides it still draws: the hull\'s box is kept clear of dust in the march');
ctx.cameraInHull = false;
for (const [field, words] of [
  ['space', 'in space'],
  ['portalView', 'the camera is in a building'],
  ['inside', 'the player is in a building'],
  ['cameraSubmerged', 'under water'],
] as const) {
  (ctx as unknown as Record<string, boolean>)[field] = true;
  const r = why();
  ok(r !== null && r.includes(words) && !pass.enabled(ctx), `${field}: it refuses ("${r}")`);
  (ctx as unknown as Record<string, boolean>)[field] = false;
}
pass.setSize(1600, 900, { ...on, airVolumeAmount: 0 });
ok(why()?.includes('at 0') === true, `an amount of 0 refuses ("${why()}"), so the composite at nothing is never reached (the clouds' bug)`);
pass.setSize(1600, 900, on);
src = null;
ok(why()?.includes('no air field') === true, `no field: it refuses ("${why()}")`);
src = air(false);
ok(why() === 'nothing is airborne', 'nothing airborne: it refuses');
src = air(true, null);
ok(why()?.includes('not stepping') === true, 'the air not stepping (its dust off, or nothing reading it): it refuses');
src = air(true, new THREE.Texture(), false);
ok(why()?.includes('not stepping') === true && !pass.enabled(ctx), "a field that keeps its dust texture but did not carry it this frame (the moving air or the dust turned off with the master on): it refuses rather than draw the frozen dust, in a storm too");
src = air();
pass.setSize(1600, 900, { ...on, volumetrics: false });
ok(why()?.includes('master is off') === true, 'and the master off: it refuses, whatever its own switch says');
// The chain's own rule over it: unwanted with the master off whatever its switch says.
const def = FX_PASSES.find((d) => d.id === 'airVolume')!;
ok(!fxPassWanted(def, { ...on, volumetrics: false }) && !fxPassWanted(def, { ...on, volumetrics: false }, true) && fxPassWanted(def, on), "the chain's rule: wanted only with the master on, an override notwithstanding");
ok(!def.typical && def.budgetMs > 0 && !def.canBeLast, 'it is not in the typical frame, has its budget and is never the last pass');

// --- materials, the target, resizes ---
pass.setSize(1600, 900, on);
const mats = pass.materials();
ok(mats.length === 3 && mats.map((m) => (m.material as THREE.ShaderMaterial).name).join() === 'fx.airVolume.march,fx.airVolume.resolve,fx.airVolume.composite', 'it lists the march, the resolve and the composite for the warm-up');
let disposed = 0;
for (const m of mats) m.material.addEventListener('dispose', () => disposed++);
for (const r of [0.25, 0.5, 1, 0.5, 0.25]) {
  pass.setSize(1600, 900, { ...on, airVolumeResolution: r });
  const size = pass.report().size as [number, number];
  ok(size[0] === Math.round(1600 * r) && size[1] === Math.round(900 * r), `at ${r} of the screen its target is ${size[0]}x${size[1]}`);
}
for (const steps of [6, 16, 48, 200]) {
  pass.setSize(1600, 900, { ...on, airVolumeSteps: steps });
  ok((pass.report().steps as number) === Math.min(steps, MAX_VOLUME_STEPS), `${steps} steps asked: ${Math.min(steps, MAX_VOLUME_STEPS)} marched, under the loop's bound`);
}
pass.setSize(800, 450, on);
ok(disposed === 0, 'no resize and no dial disposes a material: a program is never released to be built again on a live frame');

// --- the cascade sampler, the vertex stage, the light ---
const march = (mats[0].material as THREE.ShaderMaterial).uniforms;
for (const k of ['tShadow0', 'tShadow1', 'tShadow2']) {
  const t = march[k].value as THREE.DepthTexture | null;
  ok(!!t && t.isDepthTexture === true && t.compareFunction !== null && t.compareFunction !== undefined, `${k} holds a real compare depth texture from the start, never null`);
}
ok(/C\.maps\[0\] \?\? none : none/.test(source('core/fx/airVolume.ts')), 'and a cascade with no map is given the stand-in each frame, never null');
ok(!/sampler2DShadow|shadow2D|tShadow/.test(FX_FULLSCREEN_VERTEX), 'no shadow compare in the vertex stage');
const m = AIR_VOLUME_FRAGMENTS.march;
ok((m.match(/texture\(uLight,/g) ?? []).length === 1 && m.indexOf('texture(uLight,') > m.indexOf(`for (int i = 0; i < ${MAX_VOLUME_STEPS}; i++)`), 'the light pass is sampled once a step, inside the march');

// --- wave 2b: the carried shape, the light at the sample's height, the near fade, the views, the band ---
ok(m.includes('vec4 sh = texture(uShape, uv);') && m.includes('float mu = sh.r / D;') && m.includes('float sg = sqrt(max(sh.g / D - mu * mu, uSpreadMin * uSpreadMin));') && m.includes('float dens = D * uH0 * airProfile(hy, mu, sg) * uExtinction * uAmount;'), "the march reads the shape each patch carries and draws its folded profile at H₀: a unit of dust keeps the first wave's column wherever its mass sits");
ok(!m.includes('exp(-hy / max(uInflow.y'), "the first wave's one height scale for the whole window is gone");
ok(m.includes('exp(-max(lightTau(texture(uLight, uv + uLightShift), hy), 0.0))') && m.includes('if (h <= uLightH.x) return t.x;') && m.includes('return t.w;'), "the light toward the sun is taken at the sample's own height: τ interpolated over the four, exp(−τ)");
ok(m.includes('* uBright;') && (m.match(/\* uBright;/g) ?? []).length === 2, 'the brightness multiplies the dust\'s light in the window and past it');
{
  // The near fade: a uniform branch round the whole term, never a smoothstep of its two ends anywhere else.
  const smooths = m.match(/smoothstep\(uNearFrom, uNearTo, t\)/g) ?? [];
  ok(smooths.length === 1 && m.includes('if (uNearTo > uNearFrom) dens *= smoothstep(uNearFrom, uNearTo, t);'), 'the near fade is a uniform branch round the whole term, taken only while its far end is past its near one (no smoothstep of equal edges)');
  let same = true;
  let seed = 7;
  const rnd = (): number => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0), seed / 4294967296);
  for (let i = 0; i < 5000; i++) {
    const d = rnd() < 0.1 ? [-0, Number.NaN, Infinity][i % 3] : rnd() * 3;
    const t = rnd() * 50;
    if (!Object.is(nearFade(d, t, 0, 0), d) || !Object.is(nearFade(d, t, 2, 1), d)) same = false;
  }
  ok(same, "its mirror at both ends nought (or the ends the wrong way round) answers the density as it came, by Object.is: today's march");
  ok(near(nearFade(1, 0.2, 0.5, 2.5), 0) && near(nearFade(1, 3, 0.5, 2.5), 1) && nearFade(1, 1.5, 0.5, 2.5) > 0 && nearFade(1, 1.5, 0.5, 2.5) < 1, 'and with its starts, nothing within half a metre of the lens and all of it by two and a half');
  ok(source('core/fx/airVolume.ts').includes('sp.y = V.nearFrom < V.nearTo ? V.nearFrom : V.nearTo;'), "the pass hands the near end never past the far one");
}
ok(m.includes('bool viewing = uDustView > 0.5;') && m.includes('if (viewing) {') && m.includes('view = uDustView < 1.5 ? tint : vec3('), 'the debug views are a uniform branch of the march: the carried colour, its height, spread and age, no program of their own');
ok(!source('core/fx/passes.ts').includes('uDustView') && !source('core/fx/passes.ts').includes('carried'), "and never in the chain's shared debug view, whose program the game builds with the master off");
ok(m.includes('float bandTop() { return min(uAbove, uBandTop); }') && source('core/fx/airVolume.ts').includes('(u.uLook.value as THREE.Vector4).copy(src.look.value);'), "the band's top is the field's (the lifts it queued and the storm), under the band's ceiling");
{
  // Past the window: the storm's half-normal at its weighted density, in closed form, against the mirror's own integral.
  ok(m.includes('return D * abs(airErf(max(y1, 0.0) * k) - airErf(max(y0, 0.0) * k)) / abs(dy);') && m.includes('float tau = farDepth(t0, t1, uCamera.y, dir.y, uInflow.x * uH0 * uExtinction * uAmount);'), "past the window the storm's dust is the half-normal's erf difference, at its weighted density times H₀");
  let worst = 0;
  for (const [cy, dy, sigma] of [
    [1.6, -0.05, 2.256],
    [1.6, 0.02, 15],
    [30, -0.2, 8],
    [0.5, 0.0001, 3],
    [-5, 0.1, 4],
  ]) {
    const D = 0.7;
    const t0 = 96;
    const t1 = 400;
    const got = farHalfNormalDepth(t0, t1, cy, dy, D, 0, sigma);
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const t = t0 + ((i + 0.5) / n) * (t1 - t0);
      sum += D * foldedProfile(cy + dy * t, 0, sigma) * ((t1 - t0) / n);
    }
    worst = Math.max(worst, Math.abs(got - sum) / Math.max(sum, 1e-6));
  }
  ok(worst < 2e-3, `the closed form is the profile's own integral along the ray to ${(worst * 100).toFixed(3)}% (a ray climbing, falling, from under the ground, and one barely rising)`);
}
ok(m.includes('if (inHull(p)) continue;'), "the ridden hull's box is empty air");
ok(m.includes('texture(uObstacles, uv).g > hy') && !m.includes('texture(uObstacles, uv).r'), "inside a solid, below its top, no dust is taken: the map's green, which holds a compound's rooms as well as the walls");

// --- the chain resizes it on its settings ---
const postfx = source('core/postfx.ts');
ok(postfx.includes("this.byPassId.get('airVolume')?.setSize(this.sizeV.x, this.sizeV.y, this.settings);") && postfx.includes('this.settings.airVolumeResolution !== air[0]'), "the chain's configure resizes the volume when its share of the screen moves");

console.log(`\n${checks} checks passed`);
