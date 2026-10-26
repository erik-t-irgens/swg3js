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
import { AIR_PARTICLE_SHADERS, KICK_LIFT_GLSL } from '../../../src/world/volumetrics/airParticleShaders.ts';
import { oroLift, vortLift } from '../../../src/world/volumetrics/airParticleMath.ts';
import { airHash, airRand } from '../../../src/world/volumetrics/airSpawn.ts';
import { glslFunctions, glslHash } from './glslRun.ts';
import { AIR_CLOUD_FRAGMENTS, AirCloudsPass } from '../../../src/core/fx/airClouds.ts';
import { AirCloudsFeed } from '../../../src/world/volumetrics/airCloudsFeed.ts';

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
const all: Record<string, string> = { ...Object.fromEntries(Object.entries(AIR_FRAGMENTS).map(([k, v]) => [`air.${k}`, v])), ...Object.fromEntries(Object.entries(AIR_VOLUME_FRAGMENTS).map(([k, v]) => [`airVolume.${k}`, v])), 'air.vertex': AIR_VERTEX, 'air.obstacleVertex': OBSTACLE_VERTEX, 'air.dentStampVertex': DENT_STAMP_VERTEX, ...Object.fromEntries(Object.entries(AIR_PARTICLE_SHADERS).map(([k, v]) => [`particles.${k}`, v])) };
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
// The kick-up's two draws are one text under a define: each variant scanned for a name declared twice.
for (const name of ['kickDrawVertex', 'kickDrawFragment']) {
  const twice = redeclared(glslVariant(AIR_PARTICLE_SHADERS[name], new Set(['KICK_CUT'])));
  ok(twice.length === 0, `particles.${name} with KICK_CUT: no name declared twice in one scope${twice.length ? `: ${twice.join(', ')}` : ''}`);
}
// The particles' updates never write a NaN or an Inf: a NaN in a position is a quad across the screen.
ok(AIR_PARTICLE_SHADERS.kickUpdate.includes('if (!fin4(r0) || !fin4(r1) || !fin4(r2)) return;') && AIR_PARTICLE_SHADERS.rainUpdate.includes('if (any(isnan(a)) || any(isinf(a)) || any(isnan(b)) || any(isinf(b))) {'), "the kick-up's and the rain's updates write nothing that is not finite (a dead slot, a drop born again at the box's top)");
ok(!/sampler2DShadow|swgGrassShadow\(/.test(AIR_PARTICLE_SHADERS.kickDrawVertex) && AIR_PARTICLE_SHADERS.kickDrawFragment.includes('swgGrassShadow(vSwgShadowPos, vSwgShadowLd)'), "the leaves' shadow is tapped in the fragment stage, never a shadow compare in a vertex stage (the grass's lesson)");
// The lifts' and the hash's lines, run as script against their mirrors (the hash's in unsigned 32-bit arithmetic, `glslHash`).
{
  const L = { x: 0.5, y: 3, z: 3, w: 0.15 };
  const LB = { x: 0.5, y: 3, z: 0, w: 1 };
  const fns = glslFunctions(KICK_LIFT_GLSL, ['airOroLift', 'airVortLift'], { uLift: L, uLiftB: LB });
  let same = true;
  for (const [vx, vz, gx, gz] of [[3, 0, 0.5, 0], [-4, 2, 0.3, -0.8], [20, 20, 1, 1], [0, 0, 2, 2], [-30, 1, 0.9, 0]]) if (Math.abs(fns.airOroLift(vx, vz, gx, gz) - oroLift(vx, vz, gx, gz, L.x, L.z)) > 1e-12) same = false;
  for (const curl of [0, 0.3, 0.6, -2, 5, 40, -40]) if (Math.abs(fns.airVortLift(curl) - vortLift(curl, L.w, LB.x, LB.y)) > 1e-12) same = false;
  ok(same && oroLift(20, 20, 1, 1, 0.5, 3) === 3 && oroLift(-20, 0, 1, 0, 0.5, 3) === -3 && vortLift(0.4, 0.15, 0.5, 3) === 0, "the orographic and vortex lifts: the programs' own lines, run, are the mirrors', each held to its most and the swirl's from its threshold");
  // The hash and the share drawn from it, read statement by statement out of each program that holds them and run in
  // unsigned 32-bit arithmetic: every shift and constant the program's own, held to the mirror over a sweep.
  for (const name of ['kickUpdate', 'kickDrawVertex', 'rainUpdate', 'rainDrawVertex']) {
    const h = glslHash(AIR_PARTICLE_SHADERS[name]);
    let hashSame = true;
    for (let i = 0; i < 4000; i++) {
      const x = (Math.imul(i, 2654435761) + 0x9e37) >>> 0;
      if (h.airHash(x) !== airHash(x) || h.airRand(x) !== airRand(x)) hashSame = false;
    }
    ok(hashSame && airHash(0x12345) !== airHash(0x12346), `particles.${name}: its hash, run, is the mirror's over 4,000 keys, so a test can say which slot does what with no card`);
  }
}
for (const name of ['march', 'march.bands', 'march.noise', 'march.noise2', 'resolve', 'composite']) ok(/if \(any\(isnan\(o\)\) \|\| any\(isinf\(o\)\)\)/.test(AIR_VOLUME_FRAGMENTS[name]), `airVolume.${name} zeroes a NaN or an Inf before it writes`);
for (const name of ['splat', 'vort', 'div', 'jacobi', 'grad', 'advect', 'dust', 'light', 'offsets', 'smoke']) ok(AIR_FRAGMENTS[name].includes('finite4('), `air.${name} writes through finite4, so a NaN never leaves it`);
// The dust takes its ground's tint by the tile program's own two functions, never a copy of them.
{
  const dust = AIR_FRAGMENTS.dust;
  ok(dust.includes('vec3 groundTintOf( const in vec3 c ) {') && dust.includes('vec3 groundDecode( const in vec3 c ) {') && (dust.match(/vec3 groundTintOf\(/g) ?? []).length === 1 && (dust.match(/vec3 groundDecode\(/g) ?? []).length === 1, "the dust pass holds the tile program's groundTintOf and groundDecode, once each");
  ok(source('world/volumetrics/airShaders.ts').includes('${GROUND_TINT_GLSL}') && source('world/volumetrics/airShaders.ts').includes('${GROUND_DECODE_GLSL}') && !source('world/volumetrics/airShaders.ts').includes('vec3 groundTintOf('), 'interpolated from the tile program\'s own exported text, never written out again');
}
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
ok(fieldMats.length === 27 && volumeMats.length === 6, "the field lists its twenty-seven materials (the first wave's ten, the dust's two-output fill, the blowing sand's offsets, the dents' stamp and fade, the third wave's smoke and fog and the wisps' bands, the fourth wave's kick-up update, fill and four draws and the rain's update, fill and draw, and the fifth wave's spray rings and ripple carry) and the volume its six (the march once a wisps mode, the resolve, the composite: the warm-up's lists)");
// The fourth wave's pools: their updates and fills GLSL 3, three outputs the kick-up's and two the rain's, each declared
// once at its own location and written; their draws as each is meant to be drawn.
{
  const byName = new Map(fieldMats.map((m) => [m.name, m]));
  for (const [name, outs] of [
    ['air.kick', ['o0', 'o1', 'o2']],
    ['air.kick.fill', ['o0', 'o1', 'o2']],
    ['air.rain', ['o0', 'o1']],
    ['air.rain.fill', ['o0', 'o1']],
  ] as const) {
    const m = byName.get(name)!;
    const text = m.fragmentShader;
    const declared = outs.every((o, i) => (text.match(new RegExp(`layout\\(location = ${i}\\) out highp vec4 ${o};`, 'g')) ?? []).length === 1);
    const written = outs.every((o) => new RegExp(`\\b${o}\\s*=`).test(text));
    ok(m.glslVersion === THREE.GLSL3 && declared && written && !text.includes('gl_FragColor'), `${name}: GLSL 3, its ${outs.length} outputs each declared once at its own location and written, and no gl_FragColor`);
  }
  const leaves = byName.get('air.kick.leaves')!;
  ok(!leaves.transparent && leaves.depthWrite && leaves.depthTest && leaves.side === THREE.DoubleSide && leaves.fog && (leaves.defines as Record<string, string>).KICK_CUT === '', 'air.kick.leaves: cut, opaque, writing depth, both faces, in the fog');
  for (const name of ['air.kick.puffs', 'air.kick.spray', 'air.kick.streaks']) {
    const m = byName.get(name)!;
    ok(m.transparent && !m.depthWrite && m.depthTest && m.blending === THREE.NormalBlending && m.fog && m.vertexShader === leaves.vertexShader, `${name}: blended over the depth it tests and writes none, the leaves' text without the define`);
  }
  const drops = byName.get('air.rain.drops')!;
  ok(drops.transparent && !drops.depthWrite && drops.blending === THREE.NormalBlending && !drops.fog, 'air.rain.drops: blended, writing no depth, its fog its own (the weather\'s scene has none)');
  for (const m of [leaves, drops, ...['air.kick.puffs', 'air.kick.spray', 'air.kick.streaks'].map((n) => byName.get(n)!)]) ok(m.userData.unlit === true && m.userData.dry === true, `${m.name}: unlit and dry, so no scan ever changes its program's key`);
}
ok(volumeMats.slice(0, 4).map((m) => `${m.name}:${(m.defines as Record<string, number>).WISP_MODE}`).join() === 'fx.airVolume.march:0,fx.airVolume.march.bands:1,fx.airVolume.march.noise:2,fx.airVolume.march.noise2:3' && volumeMats.slice(1, 4).every((m) => m.uniforms === volumeMats[0].uniforms), 'the march is a material a wisps mode (the Start\'s decision, class M), every one over the same uniforms by reference');
// The dust pass, its fill, the offsets and (the third wave) the smoke and fog write two outputs: GLSL 3, each output
// declared once and written, at locations 0 and 1.
{
  const mats = (field as unknown as { mats: Record<string, THREE.ShaderMaterial> }).mats;
  for (const [name, outs] of [
    ['dust', ['oDust', 'oShape']],
    ['fillDust', ['oDust', 'oShape']],
    ['offsets', ['oOffsets', 'oCarry']],
    ['smoke', ['oSmoke', 'oTint']],
  ] as const) {
    const m = mats[name];
    const text = m.fragmentShader;
    const declared = outs.every((o, i) => (text.match(new RegExp(`layout\\(location = ${i}\\) out highp vec4 ${o};`, 'g')) ?? []).length === 1);
    const written = outs.every((o) => new RegExp(`\\b${o}\\s*=`).test(text));
    ok(m.glslVersion === THREE.GLSL3 && declared && written && !text.includes('gl_FragColor'), `air.${name}: GLSL 3, its two outputs (${outs.join(', ')}) each declared once at its own location and written, and no gl_FragColor`);
  }
  ok(Object.entries(mats).every(([k, m]) => (k === 'dust' || k === 'fillDust' || k === 'offsets' || k === 'smoke' ? m.glslVersion === THREE.GLSL3 : m.glslVersion !== THREE.GLSL3)), 'and every other pass keeps its one output as it was');
  ok(source('world/volumetrics/airField.ts').includes('for (const tg of this.offsetsPair!) this.drawer.draw(this.mats.fillDust, tg);') && source('world/volumetrics/airField.ts').includes('for (const tg of this.smokePair!) this.drawer.draw(this.mats.fillDust, tg);'), 'a pair of two textures is filled by the two-output fill, never the one-output fill (which leaves its second texture undefined)');
  const dust = mats.dust.fragmentShader;
  ok(dust.includes('oShape = finite4(vec4(max(s.r, 0.0), max(s.g, 0.0), s.b, max(s.a, 0.0)));') && dust.includes('oDust = finite4(max(d, vec4(0.0)));'), "the dust pass's floor at nought is every channel's but the shape's B (D·w, signed: the fall)");
}
// The scene's draws (the kick-up's four and the rain's) were held above; every other pass is a full-screen one.
const SCENE_DRAWS = new Set(['air.kick.leaves', 'air.kick.puffs', 'air.kick.spray', 'air.kick.streaks', 'air.rain.drops']);
for (const m of [...fieldMats, ...volumeMats]) {
  if (SCENE_DRAWS.has(m.name)) continue;
  if (m.name === 'air.obstacles') {
    ok(m.blending === THREE.CustomBlending && m.blendEquation === THREE.MaxEquation && m.toneMapped === false && m.depthTest === false && m.depthWrite === false, 'air.obstacles: MAX-blended on purpose, no tone curve, no depth');
    continue;
  }
  if (m.name === 'air.dentStamp') {
    ok(m.blending === THREE.CustomBlending && m.blendEquation === THREE.AddEquation && m.blendSrc === THREE.OneFactor && m.blendDst === THREE.OneFactor && m.toneMapped === false && m.depthTest === false && m.depthWrite === false, 'air.dentStamp: added into the dents on purpose (each stamp its depth), no tone curve, no depth');
    continue;
  }
  if (m.name === 'air.kick.rings') {
    ok(m.blending === THREE.CustomBlending && m.blendEquation === THREE.AddEquation && m.blendSrc === THREE.OneFactor && m.blendDst === THREE.OneFactor && m.blendSrcAlpha === THREE.ZeroFactor && m.blendDstAlpha === THREE.OneFactor && m.toneMapped === false && m.depthTest === false && m.depthWrite === false, "air.kick.rings: added into the ripples' height on purpose (each ring its depth, the state's other channels kept), no tone curve, no depth");
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
  // As each material compiles its text: its own defines choose the branches (the kick-up's leaves and the rest share one).
  const defs = new Set(Object.keys((m.defines as Record<string, unknown>) ?? {}));
  const declared = uniformNames(glslVariant(m.fragmentShader, defs)).concat(uniformNames(glslVariant(m.vertexShader, defs))).filter((n) => !THREE_OWN.has(n));
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
  const byVolume: Record<string, THREE.ShaderMaterial> = { marchMat: volumeMats[0], resolveMat: volumeMats[4], compositeMat: volumeMats[5] };
  const writesVolume = uniformWrites(source('core/fx/airVolume.ts'));
  bad = [];
  for (const w of writesVolume) {
    const known = w.materials.map((n) => byVolume[n]).filter(Boolean);
    if (!known.length) continue;
    if (!known.some((m) => w.key in m.uniforms)) bad.push(`${w.materials.join('/')}.${w.key} via ${w.via}`);
  }
  ok(writesVolume.length > 20 && bad.length === 0, `airVolume.ts: every one of its ${writesVolume.length} uniform writes is declared on its material${bad.length ? `: ${bad.join(', ')}` : ''}`);
  // The fourth wave's pools, each file's writes to its own materials.
  for (const [file, mats] of [
    ['world/volumetrics/airParticles.ts', { updateMaterial: field.kick.updateMaterial, cutMaterial: field.kick.cutMaterial }],
    ['world/volumetrics/airRain.ts', { updateMaterial: field.rain.updateMaterial, drawMaterial: field.rain.drawMaterial }],
  ] as const) {
    const writes = uniformWrites(source(file));
    const by = mats as Record<string, THREE.ShaderMaterial>;
    const wrong: string[] = [];
    let known = 0;
    for (const w of writes) {
      const ms = w.materials.map((n) => by[n]).filter(Boolean);
      if (!ms.length) continue;
      known++;
      if (!ms.some((m) => w.key in m.uniforms)) wrong.push(`${w.materials.join('/')}.${w.key} via ${w.via}`);
    }
    ok(known > 0 && wrong.length === 0, `${file.split('/').pop()}: every one of its ${known} uniform writes to a material it names is declared there${wrong.length ? `: ${wrong.join(', ')}` : ''}`);
  }
}
// --- the seventh wave's second half: the clouds' seven programs, through the same checkers ---
{
  const feed = new AirCloudsFeed();
  const cp = new AirCloudsPass(feed);
  const items = cp.materials();
  const mats = items.map((m) => m.material as THREE.ShaderMaterial);
  ok(mats.length === 7 && mats.map((m) => m.name).join() === 'fx.airClouds.weather,fx.airClouds.lowWind,fx.airClouds.holes,fx.airClouds.march,fx.airClouds.marchHigh,fx.airClouds.resolve,fx.airClouds.composite', 'the clouds list their seven programs for the warm-up: the weather, the low deck\'s wind, the hole tick, the march, the march with the low deck compiled out, the resolve, the composite');
  // The low deck's march of its own (the Start's finding): the one march's text with the low deck's branch alone compiled
  // out, on a quad of its own (the warm compiles each item's object as it stands), sharing the march's uniform objects, and
  // the frame drawing it whenever the low deck does not draw.
  ok(mats[4].fragmentShader === AIR_CLOUD_FRAGMENTS.march.split('uLow.z > 0.5').join('false') && AIR_CLOUD_FRAGMENTS.march.includes('uLow.z > 0.5') && !mats[4].fragmentShader.includes('uLow.z > 0.5') && mats[4].fragmentShader.includes('uSmear.x > 0.5'), 'the high march is the one march with the low deck\'s branch alone compiled out (the smear stays a uniform branch)');
  ok(items[3].object !== items[4].object && (items[4].object as THREE.Mesh).material === mats[4] && mats[4].uniforms === mats[3].uniforms, 'the high march stands on a quad of its own and shares the march\'s uniform objects');
  ok(source('core/fx/airClouds.ts').includes('g.render(M.uLow.value.z > 0.5 ? this.marchQuad : this.marchHighQuad, FX_CAMERA);'), 'the frame draws the low deck\'s march only while the low deck draws, the high march otherwise');
  // No size the targets are made at in the text: the weather's texels (a setting), the low wind's and the holes' squares
  // and texels, the volumes' periods (every one a uniform).
  const csizes = [...VOL_RANGES.volCloudsWeather.options, AIR_TUNE.holes.size, AIR_TUNE.clouds.weatherSquare, AIR_TUNE.lowDeck.windSquare, AIR_TUNE.clouds.baseScale, AIR_TUNE.clouds.detailScale];
  for (const [name, text] of Object.entries(AIR_CLOUD_FRAGMENTS)) {
    const reserved = reservedWords(text);
    ok(reserved.length === 0, `airClouds.${name}: no reserved word as a name${reserved.length ? `: ${reserved.join(', ')}` : ''}`);
    const b = unbalanced(text);
    ok(b === '', `airClouds.${name}: brackets balanced${b ? ` (${b})` : ''}`);
    const twice = redeclared(glslVariant(text, new Set()));
    ok(twice.length === 0, `airClouds.${name}: no name declared twice in one scope${twice.length ? `: ${twice.join(', ')}` : ''}`);
    const s = sizesInText(text, csizes);
    ok(s.length === 0, `airClouds.${name}: no target's size in the text${s.length ? `: ${s.join('; ')}` : ''}`);
    const u = undefinedCalls(text);
    ok(u.length === 0, `airClouds.${name}: every function it calls is GLSL's own or its own${u.length ? ` (it calls ${u.join(', ')} and never defines it)` : ''}`);
    ok(!text.includes('`'), `airClouds.${name}: no backtick inside the template`);
  }
  for (const m of mats) {
    ok(m.blending === THREE.NoBlending && m.toneMapped === false && m.depthTest === false && m.depthWrite === false, `${m.name}: NoBlending, no tone curve, no depth test or write (the September's first bug: blending declared)`);
    const defs = new Set(Object.keys((m.defines as Record<string, unknown>) ?? {}));
    const declared = uniformNames(glslVariant(m.fragmentShader, defs)).concat(uniformNames(glslVariant(m.vertexShader, defs))).filter((n) => !THREE_OWN.has(n));
    const missing = declared.filter((n) => !(n in m.uniforms));
    ok(missing.length === 0, `${m.name}: every uniform its shaders declare is on the material${missing.length ? ` (missing ${missing.join(', ')})` : ''}`);
  }
  // Every uniform the pass writes is declared on the material it writes it to.
  const byName: Record<string, THREE.ShaderMaterial> = { weatherMat: mats[0], lowWindMat: mats[1], holeMat: mats[2], marchMat: mats[3], marchHighMat: mats[4], resolveMat: mats[5], compositeMat: mats[6] };
  const writes = uniformWrites(source('core/fx/airClouds.ts'));
  const wrong: string[] = [];
  let known = 0;
  for (const w of writes) {
    const ms = w.materials.map((n) => byName[n]).filter(Boolean);
    if (!ms.length) continue;
    known++;
    if (!ms.some((m) => w.key in m.uniforms)) wrong.push(`${w.materials.join('/')}.${w.key} via ${w.via}`);
  }
  ok(known > 10 && wrong.length === 0, `airClouds.ts: every one of its ${known} uniform writes to a material it names is declared there${wrong.length ? `: ${wrong.join(', ')}` : ''}`);
  // The two-output programs: GLSL 3, each output declared once at its own location and written.
  for (const [m, outs] of [
    [mats[0], ['oWeather', 'oWind']],
    [mats[3], ['oCloud', 'oDist']],
    [mats[4], ['oCloud', 'oDist']],
  ] as const) {
    const text = m.fragmentShader;
    const declared = outs.every((o, i) => (text.match(new RegExp(`layout\\(location = ${i}\\) out highp vec4 ${o};`, 'g')) ?? []).length === 1);
    const written = outs.every((o) => new RegExp(`\\b${o}\\s*=`).test(text));
    ok(m.glslVersion === THREE.GLSL3 && declared && written && !text.includes('gl_FragColor'), `${m.name}: GLSL 3, its two outputs (${outs.join(', ')}) each declared once at its own location and written`);
  }
  // NaN and Inf zeroed by every program that writes the picture; a far-plane texel sky; no fxHalfTaps (the September's bugs).
  for (const name of ['weather', 'holes', 'march', 'marchHigh', 'resolve', 'composite']) ok(/if \(any\(isnan\((o|od|w)\)\) \|\| any\(isinf\((o|od|w)\)\)\)/.test(AIR_CLOUD_FRAGMENTS[name]), `airClouds.${name} zeroes a NaN or an Inf before it writes`);
  ok(AIR_CLOUD_FRAGMENTS.march.includes('depth < uFar * 0.999'), "a far-plane depth texel is sky in the clouds' march, never a surface (the September's second bug)");
  ok(!/\bfxHalfTaps\s*\(|import[^;]*\bfxHalfTaps\b|FX_HALF_TAPS/.test(source('core/fx/airClouds.ts')), "the clouds' upsample is their own size's, never fxHalfTaps (the September's third bug)");
  ok(!/sampler2DShadow/.test(AIR_CLOUD_FRAGMENTS.march), 'no shadow compare in the clouds');
  // `cutFor` in the weather pass's text is the one the feed's curve is written for (the same sixteen pairs and count).
  ok(AIR_CLOUD_FRAGMENTS.weather.includes('uniform vec2 uCover[16];') || AIR_CLOUD_FRAGMENTS.weather.includes('uCover[16]'), "the weather pass reads the cover curve as sixteen pairs, as the feed writes it");
  cp.dispose();
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
