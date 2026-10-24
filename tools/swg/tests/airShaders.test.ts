// The volumetrics' shader strings (src/world/volumetrics/airShaders.ts, src/core/fx/airVolume.ts) through the handoff's
// two checkers, ported (`glslScan.ts`; the design's rule 15), each check first shown to fire on the fault it was written
// for: no reserved word used as a name, brackets balanced, no chunk before what it reads, no name declared twice in a
// scope, no grid or window size written into the text; every full-screen material says its blending, no tone curve, no
// depth test or write; every uniform a shader declares is on its material and every uniform either file writes is
// declared there; and the march, the resolve, the composite and every solver output zero a NaN.
//
// Node compiles no GLSL: what it cannot, `__debug.air({ selfTest: true })` compiles in the browser. Plain type stripping.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { chunkBeforeNeeds, glslVariant, redeclared, reservedWords, sizesInText, unbalanced, undefinedCalls, uniformNames, uniformWrites } from './glslScan.ts';
import { AIR_FRAGMENTS, AIR_VERTEX, DENT_STAMP_VERTEX, OBSTACLE_VERTEX } from '../../../src/world/volumetrics/airShaders.ts';
import { AIR_VOLUME_FRAGMENTS, AirVolumePass } from '../../../src/core/fx/airVolume.ts';
import { AirField, newAirFrameInput } from '../../../src/world/volumetrics/airField.ts';
import { newVolTune, VOL_RANGES } from '../../../src/world/volumetrics/volSettings.ts';
import { AIR_TUNE } from '../../../src/world/volumetrics/airTune.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const here = dirname(fileURLToPath(import.meta.url));
const source = (p: string): string => readFileSync(join(here, '..', '..', '..', 'src', p), 'utf8');

// --- each check fires on the fault it was written for ---
ok(reservedWords('float sample = 1.0; vec2 filter;').join(',') === 'filter,sample', 'the reserved-word check fires on a reserved word used as a name');
ok(reservedWords('flat out vec2 a; layout(location = 0) out vec4 c;\n#include <common>\n// half a texel').length === 0, 'and passes a qualifier in its place, a chunk named common, and a word in a comment');
ok(unbalanced('void main() { if (a) { b(); }') !== '' && unbalanced('void main() { b(c[1]); }') === '', 'the bracket check fires on an unbalanced brace and passes a balanced body');
ok(chunkBeforeNeeds('void main() {\n#include <fog_vertex>\nvec4 mvPosition;') .join() === 'fog_vertex: mvPosition' && chunkBeforeNeeds('vec4 mvPosition;\n#include <fog_vertex>').length === 0, 'the chunk check fires on fog_vertex before mvPosition, and passes it after');
ok(redeclared('void f() { float a = 1.0; float a = 2.0; }').includes('f: a'), 'the scope check fires on a name declared twice');
ok(undefinedCalls('void main() { vec4 d = vec4(1.0); gl_FragColor = finite4(max(d, vec4(0.0))); }').join() === 'finite4' && undefinedCalls('vec4 finite4(vec4 v) { return v; }\nvoid main() { if (true) { gl_FragColor = finite4(texture(t, vec2(0.5))); } }').length === 0, "the call check fires on a helper the text never defines (the dust pass's finite4, which left it unlinked in the browser) and passes GLSL's own and the text's own");
ok(sizesInText('vec2 t = 1.0 / 128.0;', [128]).length === 1 && sizesInText('uniform vec4 a[128]; void f() { for (int i = 0; i < 128; i++) {} }', [128]).length === 0, 'the size check fires on a grid size in the text, and passes an array size and a loop bound');
{
  const ts = 'const m = { a: new THREE.ShaderMaterial({ uniforms: { uOne: { value: 0 } } }) };\nm.a.uniforms.uTwo.value = 1;\nconst u = m.a.uniforms;\nu.uThree.value = 2;';
  const w = uniformWrites(ts);
  ok(w.some((x) => x.key === 'uTwo' && x.materials[0] === 'a') && w.some((x) => x.key === 'uThree' && x.materials[0] === 'a'), 'the uniform-write check finds a direct write and one through an alias');
  ok(uniformNames('uniform vec4 uA[4];\nuniform highp sampler2DShadow tS;\n// uniform float uNot;\nuniform float uB;').join() === 'tS,uA,uB', 'and the declared uniforms of a shader, arrays and precisions and all');
}

// --- every shader string of the pass ---
const sizes: number[] = [];
for (const n of VOL_RANGES.volAirDetail.options) for (const f of [1, ...VOL_RANGES.volDustDetail.options, ...VOL_RANGES.volLightDetail.options, ...VOL_RANGES.volSandDetail.options]) sizes.push(n * f);
sizes.push(AIR_TUNE.window.size, AIR_TUNE.prints.square, ...VOL_RANGES.volPrintDetail.options);
const all: Record<string, string> = { ...Object.fromEntries(Object.entries(AIR_FRAGMENTS).map(([k, v]) => [`air.${k}`, v])), ...Object.fromEntries(Object.entries(AIR_VOLUME_FRAGMENTS).map(([k, v]) => [`airVolume.${k}`, v])), 'air.vertex': AIR_VERTEX, 'air.obstacleVertex': OBSTACLE_VERTEX, 'air.dentStampVertex': DENT_STAMP_VERTEX };
for (const [name, text] of Object.entries(all)) {
  const reserved = reservedWords(text);
  ok(reserved.length === 0, `${name}: no reserved word as a name${reserved.length ? `: ${reserved.join(', ')}` : ''}`);
  const b = unbalanced(text);
  ok(b === '', `${name}: brackets balanced${b ? ` (${b})` : ''}`);
  const c = chunkBeforeNeeds(text);
  ok(c.length === 0, `${name}: no chunk before what it reads${c.length ? `: ${c.join(', ')}` : ''}`);
  const twice = redeclared(glslVariant(text, new Set()));
  ok(twice.length === 0, `${name}: no name declared twice in one scope${twice.length ? `: ${twice.join(', ')}` : ''}`);
  const s = sizesInText(text, sizes);
  ok(s.length === 0, `${name}: no grid or window size in the text${s.length ? `: ${s.join('; ')}` : ''}`);
  const u = undefinedCalls(text);
  ok(u.length === 0, `${name}: every function it calls is GLSL's own or its own${u.length ? ` (it calls ${u.join(', ')} and never defines it)` : ''}`);
  ok(!text.includes('`'), `${name}: no backtick inside the template`);
}
for (const name of ['march', 'resolve', 'composite']) ok(/if \(any\(isnan\(o\)\) \|\| any\(isinf\(o\)\)\)/.test(AIR_VOLUME_FRAGMENTS[name]), `airVolume.${name} zeroes a NaN or an Inf before it writes`);
for (const name of ['splat', 'vort', 'div', 'jacobi', 'grad', 'advect', 'dust', 'light', 'offsets']) ok(AIR_FRAGMENTS[name].includes('finite4('), `air.${name} writes through finite4, so a NaN never leaves it`);
ok(!/\bfxHalfTaps\s*\(|import[^;]*\bfxHalfTaps\b|FX_HALF_TAPS/.test(source('core/fx/airVolume.ts')),"the volume's upsample is its own size's, never fxHalfTaps (the clouds' bug)");
ok(!/sampler2DShadow/.test(AIR_VERTEX) && !/textureLod\(tShadow|texture\(tShadow/.test(AIR_VERTEX), 'no shadow compare in a vertex stage');
// The swirl is faded out across the window's edge band (the second wave measured it pumping jets along the edges, where
// the curl reads the held inflow against the air inside, up to the cap and over the whole window in still air).
ok(AIR_FRAGMENTS.vort.includes('#define uEdge uVortP.w') && AIR_FRAGMENTS.vort.includes('f *= smoothstep(0.0, uEdge, edgeD);') && source('world/volumetrics/airField.ts').includes('vp.w = AIR_TUNE.window.edge;'), "the swirl fades to nothing across the window's edge band, the band written every step");
ok(AIR_VOLUME_FRAGMENTS.march.includes('depth < uFar * 0.999'), "a far-plane depth texel is sky in the march, never a surface (the clouds' bug)");

// --- the materials, built in node ---
const stub = {
  getContext: () => ({ getExtension: () => ({}) }),
} as unknown as THREE.WebGLRenderer;
const field = new AirField(stub, newVolTune(), { ground: { sample: () => false }, boxes: null, hulls: [] });
const pass = new AirVolumePass(() => field);
const fieldMats = field.materials();
const volumeMats = pass.materials().map((m) => m.material as THREE.ShaderMaterial);
ok(fieldMats.length === 13 && volumeMats.length === 3, "the field lists its thirteen materials (the first wave's ten, the carried offsets and the dents' stamp and fade) and the volume its three (the warm-up's lists)");
for (const m of [...fieldMats, ...volumeMats]) {
  if (m.name === 'air.obstacles') {
    ok(m.blending === THREE.CustomBlending && m.blendEquation === THREE.MaxEquation && m.toneMapped === false && m.depthTest === false && m.depthWrite === false, 'air.obstacles: MAX-blended on purpose, no tone curve, no depth');
    continue;
  }
  if (m.name === 'air.dentStamp') {
    ok(m.blending === THREE.CustomBlending && m.blendEquation === THREE.AddEquation && m.blendSrc === THREE.OneFactor && m.blendDst === THREE.OneFactor && m.toneMapped === false && m.depthTest === false && m.depthWrite === false, 'air.dentStamp: added into the dents on purpose (each stamp its depth), no tone curve, no depth');
    continue;
  }
  if (m.name === 'air.dentFade') {
    ok(m.blending === THREE.CustomBlending && m.blendEquation === THREE.AddEquation && m.blendSrc === THREE.ZeroFactor && m.blendDst === THREE.SrcColorFactor && m.toneMapped === false && m.depthTest === false && m.depthWrite === false, 'air.dentFade: multiplies the dents down on purpose (dst times its own rate), no tone curve, no depth');
    continue;
  }
  ok(m.blending === THREE.NoBlending && m.toneMapped === false && m.depthTest === false && m.depthWrite === false, `${m.name}: NoBlending, no tone curve, no depth test or write`);
}
// Every uniform each shader declares is on its material.
const THREE_OWN = new Set(['modelViewMatrix', 'projectionMatrix', 'modelMatrix', 'viewMatrix', 'normalMatrix', 'cameraPosition', 'isOrthographic']);
for (const m of [...fieldMats, ...volumeMats]) {
  const declared = uniformNames(m.fragmentShader).concat(uniformNames(m.vertexShader)).filter((n) => !THREE_OWN.has(n));
  const missing = declared.filter((n) => !(n in m.uniforms));
  ok(missing.length === 0, `${m.name}: every uniform its shaders declare is on the material${missing.length ? ` (missing ${missing.join(', ')})` : ''}`);
}
// Every uniform either file writes is declared on the material it writes it to.
{
  const byField: Record<string, THREE.ShaderMaterial> = {};
  const mats = (field as unknown as { mats: Record<string, THREE.ShaderMaterial> }).mats;
  for (const [k, v] of Object.entries(mats)) byField[k] = v;
  byField.fill = mats.fill;
  const writesField = uniformWrites(source('world/volumetrics/airField.ts'));
  let bad: string[] = [];
  for (const w of writesField) {
    const known = w.materials.map((n) => byField[n]).filter(Boolean);
    if (!known.length) continue;
    if (!known.some((m) => w.key in m.uniforms)) bad.push(`${w.materials.join('/')}.${w.key} via ${w.via}`);
  }
  ok(writesField.length > 20 && bad.length === 0, `airField.ts: every one of its ${writesField.length} uniform writes is declared on its material${bad.length ? `: ${bad.join(', ')}` : ''}`);
  const byVolume: Record<string, THREE.ShaderMaterial> = { marchMat: volumeMats[0], resolveMat: volumeMats[1], compositeMat: volumeMats[2] };
  const writesVolume = uniformWrites(source('core/fx/airVolume.ts'));
  bad = [];
  for (const w of writesVolume) {
    const known = w.materials.map((n) => byVolume[n]).filter(Boolean);
    if (!known.length) continue;
    if (!known.some((m) => w.key in m.uniforms)) bad.push(`${w.materials.join('/')}.${w.key} via ${w.via}`);
  }
  ok(writesVolume.length > 20 && bad.length === 0, `airVolume.ts: every one of its ${writesVolume.length} uniform writes is declared on its material${bad.length ? `: ${bad.join(', ')}` : ''}`);
}
// The field's own frame with the master off touches nothing: no GL call from the stub (it has none to make).
{
  const t = newVolTune();
  const f2 = new AirField(stub, t, { ground: { sample: () => false }, boxes: null, hulls: [] });
  const inp = newAirFrameInput();
  inp.dt = 1 / 60;
  inp.reading = true;
  f2.update(inp);
  ok(f2.why === 'the volumetrics master is off' && !f2.forces.active, 'with the master off the field says so and its forces answer before touching anything');
}

console.log(`\n${checks} checks passed`);
