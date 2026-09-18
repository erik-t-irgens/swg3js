// The ambient occlusion's arithmetic, checked without a browser: the horizon integral, the strength
// curve, the light falloff, the ceiling's 8-bit encoding, the multi-bounce fit, the apply
// multiplier and its brightness guard, the radius and its caps, the upsample's plane weight, the
// frame's lights as the effects read them, and the registry rows. The shaders in
// `src/core/fx/ssao.ts` take their numbers from `ssaoMath.ts` and do the same arithmetic, so what is
// pinned here is what the GPU draws.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  aoMultiplier,
  aoRadius,
  cascadeShadowKeep,
  SSAO_CSM_FADE_MARGIN,
  decodeCeiling,
  encodeCeiling,
  gtaoOpenAverage,
  gtaoSlice,
  indirectFraction,
  lightFalloff,
  luminance,
  multiBounce,
  openBiased,
  planeWeight,
  SSAO_UPSAMPLE_TOLERANCE_METRES,
  SSAO_UPSAMPLE_TOLERANCE_SHARE,
  ssaoRoomsStencil,
  ssaoShape,
  upsampleTolerance,
  type AoRadius,
  type SsaoShape,
} from '../../../src/core/fx/ssaoMath.ts';
import { addPointLight, createFxLights, fillCascades, FX_MAX_CASCADES, luminanceOf, resetFxLights, setDirectional, setSpotLight } from '../../../src/core/fx/lights.ts';
import { FX_DEFAULTS, FX_KNOBS, fxPassDef } from '../../../src/core/fxRegistry.ts';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const PI = Math.PI;

// ---- The GTAO integral ----

ok(near(gtaoSlice(0, 1, 1, -PI / 2, PI / 2), 1, 1e-9), 'a slice open on both sides is fully visible');
ok(near(gtaoSlice(0, 1, 1, 0, 0), 0, 1e-9), 'a slice closed at the view direction on both sides sees nothing');
ok(near(gtaoSlice(0, 1, 1, -PI / 2, 0), 0.5, 1e-9), 'a slice open on one side sees half');

{
  let worst180 = 0;
  let lo3 = Infinity;
  let hi3 = -Infinity;
  for (const tilt of [0, 20, 45, 60, 80]) {
    for (const az of [0, 0.7, 2.1]) {
      const r = (tilt * PI) / 180;
      const n: [number, number, number] = [Math.sin(r) * Math.cos(az), Math.sin(r) * Math.sin(az), Math.cos(r)];
      worst180 = Math.max(worst180, Math.abs(gtaoOpenAverage(n, [0, 0, 1], 180) - 1));
      const v3 = gtaoOpenAverage(n, [0, 0, 1], 3);
      lo3 = Math.min(lo3, v3);
      hi3 = Math.max(hi3, v3);
    }
  }
  ok(worst180 <= 1e-3, `an open surface is fully visible at any tilt over 180 slices (worst off by ${worst180.toExponential(2)})`);
  ok(lo3 >= 0.94 && hi3 <= 1.06, `three slices keep an open surface within 0.06 of visible (${lo3.toFixed(3)} to ${hi3.toFixed(3)})`);
}

{
  // Raising either horizon (towards the view direction) never raises the visibility.
  let monotonic = true;
  const n = 0.4;
  const cosN = Math.cos(n);
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      const h0 = -PI / 2 + (i / steps) * (PI / 2);
      const h1 = PI / 2 - (j / steps) * (PI / 2);
      const v = gtaoSlice(n, cosN, 1, h0, h1);
      if (i < steps && gtaoSlice(n, cosN, 1, -PI / 2 + ((i + 1) / steps) * (PI / 2), h1) > v + 1e-12) monotonic = false;
      if (j < steps && gtaoSlice(n, cosN, 1, h0, PI / 2 - ((j + 1) / steps) * (PI / 2)) > v + 1e-12) monotonic = false;
    }
  }
  ok(monotonic, 'raising either horizon never raises visibility');
}

// ---- Strength, falloff, encoding ----

{
  const s: SsaoShape = { weight: 0, power: 0 };
  ssaoShape(0.5, s);
  ok(s.weight === 0.5 && s.power === 1.5, 'strength 0.5 is half the darkening at the base power');
  ssaoShape(1, s);
  ok(s.weight === 1 && s.power === 1.5, 'strength 1 is the full darkening at the base power');
  ssaoShape(2, s);
  ok(s.weight === 1 && s.power === 3, 'strength 2 steepens the curve');
  ssaoShape(0, s);
  ok(s.weight === 0, 'strength 0 takes nothing');
}

ok(near(lightFalloff(2, 8, 2), 0.248051, 1e-5), 'three\'s falloff at 2 m of an 8 m light');
ok(lightFalloff(8, 8, 2) === 0, 'nothing at the cutoff');
ok(near(lightFalloff(0.05, 8, 2), 100, 1e-3), 'the falloff is held to 100 right at the light');
ok(near(indirectFraction(0.35, 1.8), 0.1628, 1e-4), 'the ambient share of sky 0.35 and sun 1.8');
ok(indirectFraction(0.35, 0) === 1, 'no direct light: all ambient');
ok(indirectFraction(0, 0) === 0, 'no light at all: nothing to occlude');

{
  let worst = 0;
  for (let i = 0; i <= 400; i++) {
    const x = Math.pow(2, -8 + (16 * i) / 400);
    const back = decodeCeiling(Math.round(encodeCeiling(x) * 255) / 255);
    worst = Math.max(worst, Math.abs(back / x - 1));
  }
  ok(worst <= 0.023, `the ceiling survives 8 bits within 2.3% from 2^-8 to 2^8 (worst ${(worst * 100).toFixed(2)}%)`);
  ok(encodeCeiling(0) === 0 && encodeCeiling(1e9) === 1, 'the ceiling clamps at both ends');
}

ok(multiBounce(0.5, 0) === 0.5, 'a black surface gets no bounce');
ok(near(multiBounce(0.5, 0.4), 0.6376, 1e-4), 'multi-bounce at albedo 0.4');
ok(near(multiBounce(0.5, 0.9), 0.8545, 1e-4), 'multi-bounce at albedo 0.9');
{
  let inRange = true;
  for (let i = 0; i <= 50; i++) {
    for (let j = 0; j <= 18; j++) {
      const v = i / 50;
      const m = multiBounce(v, j * 0.05);
      if (m < v - 1e-12 || m > 1.00005 + 1e-12) inRange = false;
    }
  }
  ok(inRange, 'multi-bounce lies between the visibility and 1, overshooting by at most 5e-5 (the clamp\'s comment)');
}
ok(openBiased(0.985, 0.985) === 1, 'the open bias lifts 0.985 to open');
ok(near(openBiased(0.769, 0.985), 0.7807, 1e-4), 'the open bias lifts a crease by about 1.2%');
ok(openBiased(1, 0.985) === 1, 'the open bias never passes 1');

// ---- The apply multiplier ----

ok(near(aoMultiplier({ ao: 0.78, fraction: 0.902, ceiling: 0.127, lum: 0.052, fade: 1, strength: 1 }), 0.8105, 0.005), 'a shaded wall base (GPU 0.811)');
ok(near(aoMultiplier({ ao: 0.78, fraction: 0.902, ceiling: 0.127, lum: 0.052, fade: 1, strength: 2 }), 0.6564, 0.005), 'a shaded wall base at strength 2 (GPU 0.657)');
ok(aoMultiplier({ ao: 0.925, fraction: 0.898, ceiling: 0.138, lum: 1.609, fade: 1, strength: 1 }) >= 0.995, 'a glow over a shaded crease is left alone (GPU 0.998)');
ok(aoMultiplier({ ao: 0.5, fraction: 0, ceiling: 0.5, lum: 0.2, fade: 1, strength: 1 }) === 1, 'no ambient share: untouched');
ok(aoMultiplier({ ao: 0.5, fraction: 0.9, ceiling: 0.5, lum: 0.2, fade: 0, strength: 1 }) === 1, 'faded out: untouched');
ok(aoMultiplier({ ao: 0.5, fraction: 0.9, ceiling: 0.5, lum: 0.2, fade: 1, strength: 0 }) === 1, 'strength 0: untouched');
{
  const base = { ao: 0.8, fraction: 0.14, ceiling: 0.86, lum: 0.34, fade: 1, strength: 1 };
  ok(aoMultiplier({ ...base, directShare: 1 }) < aoMultiplier({ ...base, directShare: 0 }), 'taking a share of the direct light darkens a sunlit crease more');
  let inside = true;
  for (const ao of [0, 0.3, 0.7, 1]) {
    for (const fraction of [0, 0.4, 1]) {
      for (const ceiling of [0.01, 0.2, 5]) {
        for (const lum of [0, 0.05, 1, 20]) {
          for (const strength of [0, 0.5, 1, 2]) {
            for (const fade of [0, 0.5, 1]) {
              const m = aoMultiplier({ ao, fraction, ceiling, lum, fade, strength, directShare: 0.3 });
              if (!(m >= 0 && m <= 1)) inside = false;
            }
          }
        }
      }
    }
  }
  ok(inside, 'the multiplier never darkens past black nor brightens');
}

// ---- Radius and upsample ----

{
  const r: AoRadius = { metres: 0, pixels: 0, open: false };
  const t = Math.tan(PI / 6);
  aoRadius(1.2, 95, 720, t, r);
  ok(near(r.pixels, 7.876, 0.001) && near(r.metres, 1.2, 1e-6) && !r.open, 'at 95 m the reach is the setting, 7.9 px');
  aoRadius(1.2, 8, 720, t, r);
  ok(near(r.pixels, 93.53, 0.01) && near(r.metres, 1.2, 1e-6), 'at 8 m the reach is the setting, 93.5 px');
  aoRadius(1.2, 4, 720, t, r);
  ok(near(r.pixels, 180, 1e-9) && near(r.metres, 1.1547, 0.001), 'at 4 m the pixel cap takes over');
  aoRadius(1.2, 1, 720, t, r);
  ok(near(r.pixels, 180, 1e-9) && near(r.metres, 0.2887, 0.001), 'at 1 m the reach is 0.29 m');
  aoRadius(1.2, 0.5, 720, t, r);
  ok(near(r.pixels, 180, 1e-9) && near(r.metres, 0.1443, 0.001), 'at 0.5 m the reach is 0.14 m');
  aoRadius(1.2, 1, 540, t, r);
  ok(near(r.pixels, 135, 1e-9) && near(r.metres, 0.2887, 0.001), 'the cap is a share of the buffer height, so the reach in metres keeps');
  aoRadius(0.4, 400, 720, t, r);
  ok(r.open, 'under 1.5 px the texel is written open');
}

ok(near(upsampleTolerance(10), 0.13, 1e-12), 'the upsample tolerance at 10 m is 13 cm');
ok(planeWeight([0, 1, 0], [0.4, 0, -0.2], 0.13) === 1, 'a pixel on the tap\'s plane takes it fully');
ok(planeWeight([0, 1, 0], [0, 0.18, 0], 0.13) === 0, 'a step off the plane takes none of it');
ok(near(planeWeight([0, 2, 0], [0, 0.05, 0], 0.13), 0.615, 0.001), 'an unnormalised normal is weighed by its length');
ok(ssaoRoomsStencil(true) === 1 && ssaoRoomsStencil(false) === 3, 'the rooms are stencil 1 from inside and 3 through doors from outside');
{
  // The upsample chunk carries the tolerance as literals so it can live in glsl.ts; they must match
  // wherever it lives.
  const src = ['ssao.ts', 'glsl.ts'].map((f) => readFileSync(new URL(`../../../src/core/fx/${f}`, import.meta.url), 'utf8')).join('\n');
  ok(src.includes(`zFull * ${SSAO_UPSAMPLE_TOLERANCE_SHARE} + ${SSAO_UPSAMPLE_TOLERANCE_METRES}`), 'the shader\'s upsample tolerance is upsampleTolerance\'s');
  ok(src.includes('(fragCoord - 1.5) * 0.5') && src.includes('(vec2(t) * 2.0 + 1.5) / fullSize') && src.includes('(vec2(t) * 2.0 + 1.5) / uFullSize'), 'half texel t is placed at full texel 2t + 1, where the half-resolution depth samples it');
}

// ---- Lights ----

ok(luminanceOf(new THREE.Color(1, 1, 1), 2) === 2 && near(luminance(1, 1, 1), 1, 1e-12), 'white at intensity 2 is luminance 2');

{
  const L = createFxLights();
  const lights: THREE.PointLight[] = [];
  for (let i = 0; i < 14; i++) {
    const l = new THREE.PointLight(0xff8040, 1 + i, 10, 2);
    l.position.set(i, 2 * i, -i);
    if (i === 1 || i === 4) l.intensity = 0;
    if (i === 2) l.visible = false;
    l.updateMatrixWorld();
    lights.push(l);
  }
  let count = 0;
  for (let i = 0; i < lights.length; i++) count = addPointLight(L.rooms.points, count, lights[i], 100 + i);
  ok(count === 8, 'a full list stops at its length');
  const kept = L.rooms.points.slice(0, count);
  ok(kept.every((p) => p.luminance > 0), 'no dark or hidden light is kept');
  ok(kept[0].position.equals(new THREE.Vector3(0, 0, 0)) && kept[1].position.equals(new THREE.Vector3(3, 6, -3)), 'positions come from the world matrix, skipping the dark and hidden');
  const c = new THREE.Color(0xff8040);
  ok(near(kept[1].color.r, c.r * 4, 1e-6) && near(kept[1].color.g, c.g * 4, 1e-6), 'the colour is colour times intensity');
  ok(kept[1].cell === 103 && kept[1].distance === 10 && kept[1].decay === 2, 'each keeps its cell, cutoff and decay');
}

{
  const d = createFxLights().sky.fill;
  const l = new THREE.DirectionalLight(0xffffff, 1.5);
  l.position.set(0, 10, 0);
  l.target.position.set(3, 0, 0);
  l.updateMatrixWorld();
  l.target.updateMatrixWorld();
  setDirectional(d, l);
  const want = new THREE.Vector3(-3, 10, 0).normalize();
  ok(d.direction.distanceTo(want) < 1e-6 && near(d.luminance, 1.5, 1e-9), 'a directional light points towards itself from its target');
  l.visible = false;
  setDirectional(d, l);
  ok(d.luminance === 0 && d.color.r === 0 && d.color.g === 0 && d.color.b === 0, 'a hidden directional light is black');
}

{
  const L = createFxLights();
  const torch = new THREE.SpotLight(0xffffff, 260, 70, 0.42, 0.45, 1.6);
  torch.updateMatrixWorld();
  torch.target.updateMatrixWorld();
  setSpotLight(L.sky.torch, torch);
  ok(near(L.sky.torch.coneCos, Math.cos(0.42), 1e-6) && near(L.sky.torch.penumbraCos, Math.cos(0.42 * 0.55), 1e-6), 'the torch\'s cone and penumbra');
  ok(near(L.sky.torch.luminance, 260, 1e-6) && L.sky.torch.distance === 70 && L.sky.torch.decay === 1.6, 'the torch\'s brightness, reach and decay');
  setSpotLight(L.sky.torch, null);
  ok(L.sky.torch.luminance === 0, 'no torch: luminance 0');
}

{
  const L = createFxLights();
  const make = (compare: THREE.DepthTexture['compareFunction'] | null) => {
    const l = new THREE.DirectionalLight(0xffffff, 2);
    l.castShadow = true;
    l.shadow.bias = -0.0005;
    l.shadow.normalBias = 0.05;
    (l.shadow as unknown as { map: unknown }).map = { depthTexture: { compareFunction: compare } };
    return l;
  };
  const lights = [make(THREE.LessEqualCompare), make(THREE.LessEqualCompare), make(THREE.LessEqualCompare)];
  fillCascades(L.sky.cascades, { shadowMap: { enabled: true } }, lights, [0.1, 0.4, 1], 200);
  const C = L.sky.cascades;
  ok(C.count === FX_MAX_CASCADES, 'three PCF cascades with the shadow map on are taken');
  ok([...C.ranges].every((v, i) => near(v, [0, 0.1, 0.1, 0.4, 0.4, 1][i], 1e-6)), 'each cascade covers from the last break to its own');
  ok(C.maps.every((m, i) => m === (lights[i].shadow.map as unknown as { depthTexture: unknown }).depthTexture), 'the maps are the lights\' depth textures');
  ok(near(C.params[0], -0.0005, 1e-9) && near(C.params[1], 0.05, 1e-9) && C.params[2] === 1 && C.range === 200, 'bias, normal bias, intensity and range');
  fillCascades(C, { shadowMap: { enabled: false } }, lights, [0.1, 0.4, 1], 200);
  ok(C.count === 0 && C.maps.every((m) => m === null), 'shadows off: no cascades and no maps');
  lights[1] = make(null);
  fillCascades(C, { shadowMap: { enabled: true } }, lights, [0.1, 0.4, 1], 200);
  ok(C.count === 0 && C.maps.every((m) => m === null), 'a map that is not compare-mode: no cascades and no maps');
  ok(C.fade === false, 'CSM\'s fade is off unless handed on');
  fillCascades(C, { shadowMap: { enabled: true } }, [make(THREE.LessEqualCompare), make(THREE.LessEqualCompare), make(THREE.LessEqualCompare)], [0.1, 0.4, 1], 200, true);
  ok(C.count === FX_MAX_CASCADES && C.fade === true, 'CSM\'s fade is handed on with the cascades');

  L.rooms.lit = true;
  L.rooms.building = {};
  L.rooms.cell = 4;
  L.rooms.pointCount = 3;
  L.flashCount = 2;
  fillCascades(C, { shadowMap: { enabled: true } }, [make(THREE.LessEqualCompare), make(THREE.LessEqualCompare), make(THREE.LessEqualCompare)], [0.1, 0.4, 1], 200);
  resetFxLights(L);
  ok(L.rooms.pointCount === 0 && L.flashCount === 0 && C.count === 0, 'a reset zeroes every count');
  ok(!L.rooms.lit && L.rooms.building === null && L.rooms.cell === -1 && C.maps.every((m) => m === null), 'a reset leaves no room lit and no map held');
  ok(C.fade === false, 'a reset clears the fade');
}

// ---- The sun's shadow past the cascades (three's CSMShader) ----

{
  // Without fade, the materials take the last cascade's shadow up to its end and none past it.
  ok(cascadeShadowKeep(0.99, 0.4, 1, false) === 1 && cascadeShadowKeep(1, 0.4, 1, false) === 0 && cascadeShadowKeep(1.3, 0.4, 1, false) === 0, 'no fade: shadowed inside the last cascade, lit past its end');
  // With fade (the world's CSM): the last cascade [0.4, 1) has its middle at 0.7 and a far margin of
  // 0.25; three's ratio is min(ld - (0.4 - 0.125), 1.125 - ld) / 0.25.
  ok(cascadeShadowKeep(0.2, 0.4, 1, true) === 1 && cascadeShadowKeep(0.7, 0.4, 1, true) === 1 && cascadeShadowKeep(0.875, 0.4, 1, true) === 1, 'fade: whole up to the last cascade\'s far margin');
  ok(near(cascadeShadowKeep(1, 0.4, 1, true), 0.5, 1e-12), 'fade: half the shadow at the last break');
  ok(cascadeShadowKeep(1.125, 0.4, 1, true) === 0 && cascadeShadowKeep(2, 0.4, 1, true) === 0, 'fade: none past the far margin');
  let falling = true;
  for (let i = 0; i < 200; i++) {
    const a = 0.4 + (i / 200) * 1;
    if (cascadeShadowKeep(a + 0.005, 0.4, 1, true) > cascadeShadowKeep(a, 0.4, 1, true) + 1e-12) falling = false;
  }
  ok(falling, 'fade: the shadow only ever lessens with depth through the last cascade');
  // The shader carries the same margin and the same expression.
  const src = readFileSync(new URL('../../../src/core/fx/ssao.ts', import.meta.url), 'utf8');
  ok(SSAO_CSM_FADE_MARGIN === 0.25 && src.includes('#define CSM_FADE_MARGIN ${glslFloat(SSAO_CSM_FADE_MARGIN)}') && src.includes('min(ld - (x - 0.5 * m), y + 0.5 * m - ld) / m'), 'the shader\'s cascade fade is cascadeShadowKeep\'s');
  ok(src.includes('mix(1.0, s, uShadowParams[i].z * keep)') && src.includes('if (keep <= 0.0) return 1.0;'), 'the shader applies the kept share of the shadow and none past the cascades');
}

// ---- Registry ----

{
  ok(FX_DEFAULTS.ssaoRadius === 1.2, 'the reach defaults to 1.2 m');
  const knob = FX_KNOBS.find((k) => k.key === 'ssaoRadius');
  ok(!!knob && knob.min! <= 1.2 && 1.2 <= knob.max!, 'the reach has a knob around its default');
  ok(FX_DEFAULTS.ssao === true && FX_DEFAULTS.ssaoResolution === 0.5, 'occlusion is on at half resolution by default');
  const def = fxPassDef('ssao');
  ok(def.needs.includes('linearDepthHalf') && def.needs.includes('normalsHalf') && def.needs.includes('waterMask'), 'the ssao row names every product it may read');
  ok(def.budgetMs === 0.45 && def.typical, 'the ssao row keeps its 0.45 ms typical budget');
  ok(def.live, 'the ssao row is live, so its knobs show in the menu');
}

console.log(`\n${passed} checks passed`);
