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
import { AIR_MARCH_SOURCE, AIR_VOLUME_FRAGMENTS, AirVolumePass, MAX_VOLUME_STEPS } from '../../../src/core/fx/airVolume.ts';
import { AIR_FOG_PROFILE_GLSL, AIR_SMOKE_AT_GLSL } from '../../../src/world/volumetrics/airShaders.ts';
import { createContext } from '../../../src/core/fx/context.ts';
import { FX_DEFAULTS, FX_PASSES, fxPassWanted, type FxSettings } from '../../../src/core/fxRegistry.ts';
import { FX_FULLSCREEN_VERTEX } from '../../../src/core/fx/glsl.ts';
import type { AirSource } from '../../../src/world/volumetrics/airField.ts';
import { farHalfNormalDepth, foldedProfile, nearFade, smokeAtHeight } from '../../../src/world/volumetrics/airMath.ts';

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
function air(airborne = true, dust: THREE.Texture | null = new THREE.Texture(), dustLive = true, smokeLive = false): AirSource {
  return {
    dustLive,
    smokeLive,
    smokeField: { value: smokeLive ? new THREE.Texture() : null },
    smokeTint: { value: null },
    dustTiles: { value: new THREE.Vector2(1, 0.5 / 512) },
    velocity: { value: null },
    slabTiles: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    slabScale: { value: new THREE.Vector4(1, 1, 1, 1) },
    slabShare: { value: new THREE.Vector4(0.72, 1, 1.32, 0) },
    atlasHalf: { value: new THREE.Vector2() },
    wind: { value: new THREE.Vector2() },
    slabTop: { value: new THREE.Vector2(3.5, 9) },
    slabMid: { value: new THREE.Vector4(1.5, 6, 12, 18) },
    fog: { value: new THREE.Vector4(4, 1, 1 / 60, 0.5) },
    fogDrift: { value: new THREE.Vector2() },
    noise2: { value: null },
    noise3: { value: null },
    bands: { value: null },
    wispMode: 0,
    wispA: { value: new THREE.Vector4() },
    wispB: { value: new THREE.Vector4() },
    wispC: { value: new THREE.Vector4() },
    keepTable: { value: new Float32Array(16).fill(1) },
    airView: 0,
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
src = air(true, new THREE.Texture(), false, true);
ok(why() === null, 'with the dust off and smoke or fog carried this frame (the third wave), it draws them');
src = air(true, null, false, false);
ok(why()?.includes('not stepping') === true, 'with neither carried, it refuses');
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
ok(mats.length === 6 && mats.map((m) => (m.material as THREE.ShaderMaterial).name).join() === 'fx.airVolume.march,fx.airVolume.march.bands,fx.airVolume.march.noise,fx.airVolume.march.noise2,fx.airVolume.resolve,fx.airVolume.composite', 'it lists the march once a wisps mode (all four, class M), the resolve and the composite for the warm-up');
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
ok(m.includes('vec4 sh = texture(uShape, uv);') && m.includes('mu = sh.r / D;') && m.includes('sg = sqrt(max(sh.g / D - mu * mu, uSpreadMin * uSpreadMin));') && m.includes('float dens = D * uH0 * airProfile(hy, mu, sg) * uExtinction * uAmount;'), "the march reads the shape each patch carries and draws its folded profile at H₀: a unit of dust keeps the first wave's column wherever its mass sits");
ok(!m.includes('exp(-hy / max(uInflow.y'), "the first wave's one height scale for the whole window is gone");
ok(m.includes('exp(-max(lightTau(texture(uLight, uv + uLightShift), hy), 0.0))') && m.includes('if (h <= uLightH.x) return t.x;') && m.includes('return t.w;'), "the light toward the sun is taken at the sample's own height: τ interpolated over the four, exp(−τ)");
ok(m.includes('vec3 tint = (colD * uBright + colS * densS + uFogColor * densF) / max(densD + densS + densF, 1e-6);') && (m.match(/\* uBright;/g) ?? []).length === 1, "the brightness multiplies the dust's share of the light in the window (never the smoke's or the fog's) and the storm's past it");
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

// --- the third wave: smoke and fog, the dust's tiles, the wisps ---
{
  const src0 = AIR_MARCH_SOURCE;
  ok(src0.includes(AIR_SMOKE_AT_GLSL.trim()) && src0.includes(AIR_FOG_PROFILE_GLSL.trim()) && src0.includes('float sm = smokeAt(hy, s.xyz);'), "smoke is read between the slabs' middles by the shared smokeAt (the light pass's own), never a copy");
  // The mirror at the slab centres: each slab's own smoke exactly there, linear between, fading in under slab 0's middle.
  const S0 = 0.9;
  const S1 = 0.4;
  const S2 = 0.1;
  const [m0, m1, m2, top] = [1.5, 6, 12, 18];
  ok(near(smokeAtHeight(m0, S0, S1, S2, m0, m1, m2, top), S0) && near(smokeAtHeight(m1, S0, S1, S2, m0, m1, m2, top), S1) && near(smokeAtHeight(m2, S0, S1, S2, m0, m1, m2, top), S2), "smoke is each slab's own at the slab's middle");
  ok(near(smokeAtHeight((m0 + m1) / 2, S0, S1, S2, m0, m1, m2, top), (S0 + S1) / 2) && near(smokeAtHeight((m1 + m2) / 2, S0, S1, S2, m0, m1, m2, top), (S1 + S2) / 2), 'and linear between them, with no step at a slab\'s edge');
  ok(smokeAtHeight(0, S0, S1, S2, m0, m1, m2, top) < S0 && smokeAtHeight(top, S0, S1, S2, m0, m1, m2, top) === 0, "fading in from the ground under slab 0's middle and out by the band's top");
  ok(src0.includes('densF = s.w * fogProfileAt(hy, ftop) * uAirQ.y * uAmount;') && src0.includes('float ftop = uFog.x * (uAirQ.w + (1.0 + uAirQ.z - uAirQ.w) * tn);'), "the fog under a top varied by the noise (fogTopAt's line), never one number");
  ok(src0.includes('vec2 tileUv(int k, vec2 q) {') && src0.includes('if (float(k) >= uAirR.y) break;'), "the dust a tile at a time: one, or a field a layer (Ultra's)");
  // The wisps: a material a mode, the noise only by textureLod (never the implicit derivatives inside the divergent loop),
  // the erosion and the age term each in a uniform branch round the whole term, all of it compiled out with the mode off.
  ok(!/texture\(uNoise3/.test(src0) && (src0.match(/textureLod\(uNoise3,/g) ?? []).length === 4 && src0.includes('return lightTau(textureLod(uBands, q, 0.0), hy);'), 'the wisps read their noise and their bands only through textureLod');
  ok(src0.includes('if (uWispC.x > 0.0) {') && src0.includes('if (uWispB.w > 0.0) ag = smoothstep(0.0, uWispB.w, age);') && src0.includes('float e = uWispC.x * (0.4 + 0.6 * clamp(abs(hy - dmu) / sg, 0.0, 1.0)) * ag;'), 'the erosion is a uniform branch on erode above nought, the age term one on ageWisp above nought, stronger at a patch\'s top and bottom');
  ok(src0.includes('float keep = mix(1.0, cut, clamp(ee / max(uWispC.y, 1e-3), 0.0, 1.0));') && src0.includes('if (uWispC.z > 0.0) keep /= max(mix(1.0, expectedKeep(ee), uWispC.z), uWispC.w);'), "the erosion's remap is one at an erosion of nought, and keepColumn divides by a keep never under keepFloor");
  const off = AIR_VOLUME_FRAGMENTS.march;
  const wispStart = src0.indexOf('#if WISP_MODE > 0');
  ok(off.startsWith('#define WISP_MODE 0\n') && wispStart > 0 && src0.indexOf('wispNoise(') > wispStart, "with the mode off every line of the wisps is compiled out (the march of before, with the third wave's smoke and fog)");
  ok(AIR_VOLUME_FRAGMENTS['march.noise2'].startsWith('#define WISP_MODE 3\n') && src0.includes('#if WISP_MODE == 3'), 'noise ×2 adds the finer octave on the air a layer up');
  ok(source('core/fx/airVolume.ts').includes('g.render(this.marchQuads[mode], FX_CAMERA);'), 'the frame draws the march of the mode the field has in force');
  // The fog past the window, and the puffs' rule's amount.
  ok(src0.includes('tau += uAirR.x * fogProfileAt(uCamera.y + dir.y * tj - uBand.z, uFog.x) * st;'), 'past the window the fog the hour carries in, under the hour\'s top over the window\'s mean ground');
  ok(source('core/fx/airVolume.ts').includes('src.volumeAmount = this.q.amount;'), "the volume tells the field its amount each frame it draws (the gas cloud's puffs read it)");
}

// --- the fourth wave's cold warm: a wisps mode whose march is not linked is never drawn, the last ready one stands in ---
{
  // The pass's own frame through a stand-in renderer that records the material of every quad it is asked to draw.
  const drawn: string[] = [];
  const g = {
    setRenderTarget: (): void => undefined,
    render: (o: THREE.Object3D): void => void drawn.push(((o as THREE.Mesh).material as THREE.Material).name),
  };
  const out = new THREE.WebGLRenderTarget(4, 4, { depthTexture: new THREE.DepthTexture(4, 4) });
  const c2 = createContext(g as unknown as THREE.WebGLRenderer, { ...FX_DEFAULTS }, out);
  const s = air();
  const p = new AirVolumePass(() => s);
  p.setSize(1600, 900, on);
  const marchOf = (): string | undefined => {
    drawn.length = 0;
    p.render(c2, out, null);
    return drawn.find((n) => n.startsWith('fx.airVolume.march'));
  };
  const items = p.warmMaterials(2);
  ok(p.ready.join() === 'false,false,true,false' && (items[0].material as THREE.ShaderMaterial).name === 'fx.airVolume.march.noise', "the master's in-play warm builds the mode in force alone (noise) and marks only it ready");
  (s as { wispMode: number }).wispMode = 3;
  ok(marchOf() === 'fx.airVolume.march.noise', 'a frame asking for noise ×2 before its march is linked draws the noise march, the last ready mode');
  (s as { wispMode: number }).wispMode = 1;
  ok(marchOf() === 'fx.airVolume.march.noise', 'and so does one asking for the bands');
  p.ready[3] = true;
  (s as { wispMode: number }).wispMode = 3;
  ok(marchOf() === 'fx.airVolume.march.noise2', 'once noise ×2 is marked ready (its march linked off the frame), the frame draws it');
  (s as { wispMode: number }).wispMode = 1;
  ok(marchOf() === 'fx.airVolume.march.noise2', 'and a mode still not ready then draws as the last one drawn, noise ×2, never a march unlinked');
  p.ready.fill(true);
  ok(marchOf() === 'fx.airVolume.march.bands', 'behind a loading screen every mode is built, and each draws as asked');
  p.warmMaterials(0);
  (s as { wispMode: number }).wispMode = 2;
  ok(marchOf() === 'fx.airVolume.march' && p.ready.join() === 'true,false,false,false', 'with the wisps off in force at the warm, only the plain march is ready and every other mode draws as it');
  p.dispose();
}

// --- the chain resizes it on its settings ---
const postfx = source('core/postfx.ts');
ok(postfx.includes("this.byPassId.get('airVolume')?.setSize(this.sizeV.x, this.sizeV.y, this.settings);") && postfx.includes('this.settings.airVolumeResolution !== air[0]'), "the chain's configure resizes the volume when its share of the screen moves");

console.log(`\n${checks} checks passed`);
