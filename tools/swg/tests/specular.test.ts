// The client's own highlight as injected into three's lighting (`src/world/specular.ts`), checked without a
// browser. Node compiles no GLSL, so what is pinned is the text three is really handed, built through the
// very hook chain `World.adoptMaterials` builds (the cascades' hook, the wet look, the detail map, then this):
//
//  - **the anchor is three's own**: three 0.185's `RE_Direct_Physical` adds every direct light's highlight with
//    one GGX line, and that line, and only that one, is replaced;
//  - **every name is declared before it is used**, in the text with every include resolved, the uniforms, the
//    two globals `main()` writes, the texel three's roughness chunk samples and the wet look's three amounts;
//  - **every line the node mirror copies is the shader's own**, the mode's branch, the dot products, the term
//    and how the film mixes in three's GGX, since a turned branch declares every name a right one does;
//  - **the world's scan really is the chain built here** (world.ts read as text), and a preview's own wrap
//    leaves the world building exactly what it would have built without it;
//  - **no name is declared twice in one scope** (the blade glow lesson's scanner), with the wet look in the
//    program and without, with a roughness map and without;
//  - **the text does not vary with the mode**, so every converted material shares one program per key;
//  - **wrapping twice adds nothing, and a hook the cascades replaced is wrapped again** (`wrapCompile`);
//  - **a shader with an anchor missing is left exactly as it was**, rather than half written;
//  - and which materials the scan wraps: a standard material that says what the client drew, and nothing else.
//
// Run: node tools/swg/tests/specular.test.ts
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { wrapsOn, type Wrappable } from '../../../src/world/compileHooks.ts';
import { applyDetail } from '../../../src/world/detailMap.ts';
import { BAND_POWER, BAND_TIGHTEN } from '../../../src/world/specMath.ts';
import { readFileSync } from 'node:fs';
import { GGX_ANCHOR, SPEC_HOOK, SPEC_LINE, SPEC_MAIN, SPEC_PARS, SPEC_TUNE, SPEC_UNIFORMS, SPEC_WRAP, applySpec, injectSpec, physicalParsWithSpec, setSpecTune, specUniformsOf, specWrap, specWrapTree } from '../../../src/world/specular.ts';
import { applyWetness } from '../../../src/world/wetness.ts';
import { glslFunction, glslVariant, redeclared } from './glslScan.ts';

/** How main() takes the film from the wet chunk: the largest of the wet surface, the puddle and the snow (`specMath.weatherShare`). */
const FILM_LINE = 'swgSpecFilm = max( max( wetSurface, wetPuddle ), wetSnow );';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

type Shader = THREE.WebGLProgramParametersWithUniforms;
const lib = THREE.ShaderLib.physical;
const fresh = (): Shader => ({ vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: THREE.UniformsUtils.clone(lib.uniforms) }) as unknown as Shader;
/** Three's own include resolution, done here so the scan reads what the renderer reads. */
const resolve = (s: string): string => s.replace(/^[ \t]*#include +<([\w\d./]+)>/gm, (_m, name: string) => {
  const chunk = (THREE.ShaderChunk as unknown as Record<string, string>)[name];
  if (chunk === undefined) throw new Error(`no chunk ${name}`);
  return resolve(chunk);
});
const count = (text: string, s: string) => text.split(s).length - 1;
const spec = (mode: string, color = [0.5, 0.5, 0.5], power = 20) => ({ mode, color, power, mask: 'SPEC.a' });
const standard = (userData: Record<string, unknown> = {}) => {
  const m = new THREE.MeshStandardMaterial();
  Object.assign(m.userData, userData);
  return m;
};
/** What three hands the program once every hook on the material has run. */
const compiled = (m: THREE.Material): Shader => {
  const s = fresh();
  m.onBeforeCompile(s, null as unknown as THREE.WebGLRenderer);
  return s;
};

// ---------------------------------------------------------------- three's own anchor

{
  const chunk = THREE.ShaderChunk.lights_physical_pars_fragment;
  const fn = glslFunction(chunk, 'RE_Direct_Physical');
  ok(THREE.REVISION === '185', `three is 0.185 (REVISION ${THREE.REVISION}), whose lighting this replaces a line of`);
  ok(fn.includes(GGX_ANCHOR), "three's RE_Direct_Physical adds each direct light's highlight with the GGX line the injection replaces");
  ok(count(chunk, GGX_ANCHOR) === 1, 'and that line is in the chunk once, so nothing else is replaced with it');
  ok(lib.fragmentShader.includes('#include <lights_physical_pars_fragment>') && lib.fragmentShader.includes('#include <lights_fragment_begin>') && lib.fragmentShader.includes('#include <roughnessmap_fragment>'), 'the physical program includes the chunk, the light loop and the roughness stage the injection writes around');
  const pars = physicalParsWithSpec()!;
  const mine = glslFunction(pars, 'RE_Direct_Physical');
  ok(!mine.includes(GGX_ANCHOR) && mine.includes(SPEC_LINE), "in the chunk as injected, RE_Direct_Physical adds the client's term in its place");
  ok(pars.indexOf('vec3 BRDF_GGX_Multiscatter(') < pars.indexOf('vec3 swgDirectSpecular(') && pars.indexOf('vec3 swgDirectSpecular(') < pars.indexOf('void RE_Direct_Physical('), "and the functions it calls are defined after three's GGX (the wet film keeps it) and before the light function calls them");
  const warns: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => void warns.push(args.join(' '));
  try {
    ok(physicalParsWithSpec(chunk.replace(GGX_ANCHOR, 'reflectedLight.directSpecular += vec3( 0.0 );')) === null && warns.length === 1, 'a three whose lighting no longer has the line gets nothing, rather than a half-written program, and says so');
  } finally {
    console.warn = warn;
  }
}

// ---------------------------------------------------------------- the text and its names

/** The material scan's order: the cascades' hook (which replaces), the wet look, the detail map, the highlight. */
function scanned(userData: Record<string, unknown>, opts: { wet?: boolean; detail?: boolean; roughness?: boolean } = {}): THREE.MeshStandardMaterial {
  const m = standard(userData);
  m.onBeforeCompile = function cascades(shader: Shader) {
    shader.uniforms.CSM_cascades = { value: [] };
  };
  if (opts.roughness) {
    const t = new THREE.Texture();
    m.roughnessMap = t;
    m.metalnessMap = t;
  }
  if (opts.wet) applyWetness(m);
  if (opts.detail) applyDetail(m, { isTexture: true } as unknown as THREE.Texture);
  specWrap(m);
  return m;
}

{
  const m = scanned({ swgSpec: spec('phong') }, { wet: true, roughness: true });
  const s = compiled(m);
  const f = s.fragmentShader;
  ok(count(f, 'uniform float swgSpecMode;') === 1 && count(f, SPEC_LINE) === 1 && count(f, 'swgSpecMask = texelRoughness.r;') === 1, 'the injection goes in once: its declarations, the replaced line and the mask read in main()');
  ok(f.indexOf('#include <lights_physical_pars_fragment>') < 0, "three's lighting chunk is written out, with the line replaced, in place of its include");
  ok(f.indexOf(SPEC_MAIN.trim().split('\n')[0]) < f.indexOf('#include <lights_fragment_begin>') && f.indexOf('#include <roughnessmap_fragment>') < f.indexOf('swgSpecMask = texelRoughness.r;'), "the mask and the wet amount are read after three's roughness stage and before the light loop");
  ok(f.indexOf('#define SWG_WET') >= 0 && f.indexOf('#define SWG_WET') < f.indexOf('#ifdef SWG_WET'), 'the wet look says it is in the program, above the place that asks');

  // Every include resolved, then the variant three really compiles: with the wet look and a roughness map.
  const full = resolve(f);
  const variant = glslVariant(full, new Set(['SWG_WET', 'USE_ROUGHNESSMAP', 'USE_SHADOWMAP', 'USE_UV']));
  const decl: [string, string][] = [
    ['uniform float swgSpecMode;', 'swgSpecMode < 0.5'],
    ['uniform vec3 swgSpecColor;', 'lightColor * swgSpecColor'],
    ['uniform float swgSpecPower;', 'max( swgSpecPower, 0.0 )'],
    ['uniform float uSwgSpecGain;', 'max( uSwgSpecGain, 0.0 )'],
    ['uniform float uSwgSpecCap;', 'max( uSwgSpecCap, 0.0 )'],
    ['uniform float uSwgSpecFilm;', 'swgSpecFilm * uSwgSpecFilm'],
    ['uniform float uSwgSpecUse;', 'uSwgSpecUse > 0.5'],
    ['uniform float uSwgSpecGate;', 'clamp( uSwgSpecGate, 0.0, 1.0 )'],
    ['float swgSpecMask = 1.0;', 'swgSpecMask * swgShape'],
    ['float swgSpecFilm = 0.0;', 'swgSpecFilm * uSwgSpecFilm'],
    ['const float SWG_BAND_TIGHTEN', 'SWG_BAND_TIGHTEN * swgH'],
    ['float swgSpecShape(', 'swgSpecShape( dot( normal, swgHalf )'],
    ['vec3 swgClientSpecular(', 'swgClientSpecular( directLight.color'],
    ['vec3 swgDirectSpecular(', SPEC_LINE],
    ['#define RECIPROCAL_PI', 'RECIPROCAL_PI );'],
    ['vec4 texelRoughness', 'swgSpecMask = texelRoughness.r;'],
    ['float wetSurface', FILM_LINE],
    ['float wetPuddle', FILM_LINE],
    ['float wetSnow', FILM_LINE],
    ['float swgSpecMask = 1.0;', 'swgSpecMask = texelRoughness.r;'],
    ['float swgSpecFilm = 0.0;', FILM_LINE],
  ];
  const late = decl.filter(([d, u]) => !(variant.indexOf(d) >= 0 && variant.indexOf(u) > variant.indexOf(d))).map(([d, u]) => `${d} / ${u}`);
  ok(late.length === 0, `every name the highlight reads is declared before it is read, in the text with every include resolved${late.length ? `: ${late.join('; ')}` : ` (${decl.length} pairs)`}`);
  // The scanner first on the fault it is for, then on the real text, with and without each branch.
  ok(redeclared(SPEC_PARS.replace('float swgLen = length( swgHalf );', 'float swgLen = length( swgHalf );\n\tfloat swgNL = 0.0;')).includes('swgClientSpecular: swgNL'), 'the scope scan finds a second swgNL in swgClientSpecular, the mistake that unlinks a program');
  // main() is three's and the wet look's as well as ours, so it is held to what the same chain without the
  // highlight gives: whatever the scanner says of their text, the highlight adds nothing to it.
  const without = resolve(compiled(scanned({}, { wet: true, roughness: true })).fragmentShader);
  const twice: string[] = [];
  for (const defines of [['SWG_WET', 'USE_ROUGHNESSMAP'], ['USE_ROUGHNESSMAP'], ['SWG_WET'], []]) {
    const ours = glslVariant(SPEC_PARS + glslFunction(full, 'RE_Direct_Physical'), new Set(defines));
    twice.push(...redeclared(ours).map((t) => `${defines.join('+') || 'plain'}: ${t}`));
    const base = new Set(redeclared(glslVariant(without.slice(without.indexOf('void main()')), new Set(defines))));
    const main = redeclared(glslVariant(full.slice(full.indexOf('void main()')), new Set(defines))).filter((t) => !base.has(t));
    twice.push(...main.map((t) => `${defines.join('+') || 'plain'} main: ${t}`));
  }
  ok(twice.length === 0, `no name the highlight declares, nor any it adds to main(), is declared twice in one scope, with and without the wet look and a roughness map${twice.length ? `: ${twice.join(', ')}` : ''}`);
  ok(SPEC_PARS.includes(`const float SWG_BAND_TIGHTEN = ${BAND_TIGHTEN};`) && SPEC_PARS.includes(`const float SWG_BAND_POWER = ${BAND_POWER};`), "the band's constants are the very numbers specMath.ts uses");
  // The lines the node mirror copies, as written (specMath.clientSpecular, specShape, filmShare and
  // weatherShare): which shape each mode takes, the half vector and the two dot products the shape is fed,
  // the term and its every factor, every floor and the cap, and how the film mixes three's GGX with the
  // client's term. Pinned whole, because a node run compiles no GLSL: a branch turned round, the eye's
  // direction swapped for the light's or the film's weight on the wrong side all leave every name declared.
  for (const line of [
    'if ( swgSpecMode > 1.5 ) {',
    'float swgH = clamp( nh, 0.0, 1.0 );',
    'float swgB = max( 1.0 - abs( 1.0 - SWG_BAND_TIGHTEN * swgH ), 1e-6 );',
    'return max( pow( swgB, max( swgSpecPower, 0.0 ) * SWG_BAND_POWER ) - SWG_BAND_POWER, 0.0 ) * clamp( nl, 0.0, 1.0 );',
    'return pow( max( swgH, 1e-6 ), max( swgSpecPower, 0.0 ) );',
    'if ( swgSpecMode < 0.5 ) return vec3( 0.0 );',
    'vec3 swgHalf = lightDir + viewDir;',
    'float swgLen = length( swgHalf );',
    'if ( swgLen < 1e-6 ) return vec3( 0.0 );',
    'float swgNL = dot( normal, lightDir );',
    'float swgShape = swgSpecShape( dot( normal, swgHalf ) / swgLen, swgNL );',
    'float swgGate = mix( 1.0, step( 1e-4, swgNL ), clamp( uSwgSpecGate, 0.0, 1.0 ) );',
    'vec3 swgTerm = lightColor * swgSpecColor * ( swgSpecMask * swgShape * swgGate * max( uSwgSpecGain, 0.0 ) * RECIPROCAL_PI );',
    'return min( swgTerm, lightColor * ( max( uSwgSpecCap, 0.0 ) * RECIPROCAL_PI ) );',
    'float swgFilm = uSwgSpecUse > 0.5 ? 1.0 : clamp( swgSpecFilm * uSwgSpecFilm, 0.0, 1.0 );',
    'if ( swgFilm > 0.0 ) swgOut += swgFilm * irradiance * BRDF_GGX_Multiscatter( directLight.direction, geometryViewDir, geometryNormal, material );',
    'if ( swgFilm < 1.0 ) swgOut += ( 1.0 - swgFilm ) * swgClientSpecular( directLight.color, directLight.direction, geometryNormal, geometryViewDir );',
  ]) ok(SPEC_PARS.includes(line), `the shader writes ${line.slice(0, 70)}...`);
  ok(SPEC_PARS.split('swgOut +=').length - 1 === 2 && SPEC_PARS.includes('return swgOut;'), 'and the direct highlight is those two terms and nothing else');
  // The client's term is handed the shading normal: the one three's own GGX line beside it is handed, so a
  // bumped surface's highlight follows its normal map, and the 130 phong flora primitives take theirs from it too.
  ok(GGX_ANCHOR.includes('geometryNormal') && SPEC_PARS.includes('swgClientSpecular( directLight.color, directLight.direction, geometryNormal, geometryViewDir )'), "the client's term is given the same normal and eye three's GGX line is");
  ok(SPEC_MAIN.includes(FILM_LINE) && SPEC_MAIN.includes('swgSpecMask = texelRoughness.r;'), 'main() reads the mask from the roughness texel and the film from the wet chunk, the puddle and the snow');
}

// ---------------------------------------------------------------- one text for every mode

{
  const a = scanned({ swgSpec: spec('phong') }, { wet: true });
  const b = scanned({ swgSpec: spec('aniso', [1, 0.8, 0.6], 3) }, { wet: true });
  const c = scanned({ swgSpec: spec('none', [0, 0, 0], 0) }, { wet: true });
  const sa = compiled(a);
  const sb = compiled(b);
  const sc = compiled(c);
  ok(sa.fragmentShader === sb.fragmentShader && sb.fragmentShader === sc.fragmentShader && a.customProgramCacheKey() === b.customProgramCacheKey() && b.customProgramCacheKey() === c.customProgramCacheKey(), 'the plain highlight, the band and none build one program text under one key: the mode is a uniform');
  ok(sb.uniforms.swgSpecMode.value === 2 && (sb.uniforms.swgSpecColor.value as THREE.Vector3).equals(new THREE.Vector3(1, 0.8, 0.6)) && sb.uniforms.swgSpecPower.value === 3, "each material's own mode, colour and power are its own uniforms");
  ok(sc.uniforms.swgSpecMode.value === 0 && sa.uniforms.swgSpecMode.value === 1, 'none is nought and the plain highlight one');
  ok(sa.uniforms.uSwgSpecGain === SPEC_UNIFORMS.uSwgSpecGain && sb.uniforms.uSwgSpecUse === SPEC_UNIFORMS.uSwgSpecUse, 'and the knobs are the shared objects, by reference, so one write reaches every material');
  ok(compiled(a).uniforms.swgSpecColor === sa.uniforms.swgSpecColor && specUniformsOf(a).swgSpecColor === sa.uniforms.swgSpecColor, 'a recompile reuses the material\'s own uniforms rather than making new ones');
  ok(a.customProgramCacheKey().startsWith('wet-object|spec|') && wrapsOn(a as unknown as Wrappable).join(',') === 'wet-object,spec', `the key is prefixed spec after the wet look, as the scan puts them on (${a.customProgramCacheKey().slice(0, 24)})`);
  const before = { ...SPEC_TUNE };
  setSpecTune({ use: 'three', gain: 2, cap: 3, film: 0.5, gate: 1 });
  ok(SPEC_UNIFORMS.uSwgSpecUse.value === 1 && SPEC_UNIFORMS.uSwgSpecGain.value === 2 && SPEC_UNIFORMS.uSwgSpecCap.value === 3 && SPEC_UNIFORMS.uSwgSpecFilm.value === 0.5 && SPEC_UNIFORMS.uSwgSpecGate.value === 1, "moving the knobs writes the shared uniforms, which is all the switch to three's GGX does");
  setSpecTune({ gain: Number.NaN, cap: -1, film: 7 });
  ok(SPEC_TUNE.gain === 2 && SPEC_TUNE.cap === 3 && SPEC_TUNE.film === 1, 'a knob given nothing usable keeps its value, and the film is held to one');
  setSpecTune(before);
  ok(SPEC_TUNE.use === 'client' && SPEC_UNIFORMS.uSwgSpecUse.value === 0, 'and they go back');
}

// ---------------------------------------------------------------- wrapping, twice and after the cascades

{
  const m = scanned({ swgSpec: spec('phong') }, { wet: true });
  const key = m.customProgramCacheKey();
  for (let i = 0; i < 100; i++) {
    applyWetness(m);
    specWrap(m);
  }
  const s = compiled(m);
  ok(count(s.fragmentShader, 'uniform float swgSpecMode;') === 1 && count(s.fragmentShader, SPEC_LINE) === 1 && m.customProgramCacheKey() === key, 'a hundred more scans write nothing more and leave the key as it was');
  // The cascades set up again: their hook replaces ours, and the scan wraps afresh with the key unchanged.
  m.onBeforeCompile = function cascadesAgain(shader: Shader) {
    shader.uniforms.CSM_cascades = { value: [] };
  };
  applyWetness(m);
  specWrap(m);
  const again = compiled(m);
  ok(count(again.fragmentShader, SPEC_LINE) === 1 && count(again.fragmentShader, 'uniform float swgSpecMode;') === 1 && !!again.uniforms.CSM_cascades, 'a hook the cascades replaced is wrapped again, once, after theirs');
  ok(m.customProgramCacheKey() === key, `and the key is what it was, not one prefix longer (${m.customProgramCacheKey().slice(0, 24)})`);
  // With the detail map between them, as the scan has it for a detailed surface.
  const d = scanned({ swgSpec: spec('phong'), swgDetail: 'x' }, { wet: true, detail: true });
  const sd = compiled(d);
  ok(count(sd.fragmentShader, SPEC_LINE) === 1 && sd.fragmentShader.includes('swgDetailMap') && sd.fragmentShader.includes('uniform float uWetness'), 'beside the wet look and the detail map, each is written once');
}

// ---------------------------------------------------------------- the world's scan, as it is written

{
  // The order the chain above is built in is the world's own only if world.ts says so: the cascades' setup,
  // the wet look, the detail map and then the highlight, in one iteration of one traverse.
  // A checkout may carry Windows line ends: read as one kind, so the method's closing brace is found either way.
  const world = readFileSync(new URL('../../../src/world/world.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const start = world.indexOf('adoptMaterials(root: THREE.Object3D): THREE.Object3D[] {');
  const body = start >= 0 ? world.slice(start, world.indexOf('\n  }\n', start)) : '';
  ok(/for \(const m of mats\) \{[\s\S]*?csm\.setupMaterial\(m\);[\s\S]*?if \(csm && WET_WRAP\) wetWrap\(m, o\);[\s\S]*?if \(m\.userData\.swgDetail\) detailWrap\(m\);\s*(?:\/\/[^\n]*\n\s*)*if \(m\.userData\.swgSpec\) specWrap\(m\);\s*\}/.test(body), 'World.adoptMaterials wraps the highlight last, after the cascades, the wet look and the detail map, in the same iteration over a mesh\'s materials');
  ok((world.match(/specWrap\(/g) ?? []).length === 1, 'and nowhere else in the world, so no material is wrapped out of that order');
}

// ---------------------------------------------------------------- a preview's own wrap, then the world's

{
  // The select screen, the creator's dark stage and the ship edit page wrap what the world has not adopted
  // (`specWrapTree`, `specWrap`); the world, when it adopts the same material, must build exactly what it would
  // have built had the preview never touched it.
  const onlyWorld = standard({ swgSpec: spec('aniso') });
  const seenFirst = standard({ swgSpec: spec('aniso') });
  const other = standard({ swgSpec: spec('phong') });
  const unconverted = standard();
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BufferGeometry(), [seenFirst, unconverted]));
  root.add(new THREE.Mesh(new THREE.BufferGeometry(), other));
  specWrapTree(root);
  ok(wrapsOn(seenFirst as unknown as Wrappable).join() === 'spec' && wrapsOn(other as unknown as Wrappable).join() === 'spec' && wrapsOn(unconverted as unknown as Wrappable).length === 0, 'a preview wraps every material of its figure or hull that says what the client drew, a list of materials included, and nothing else');
  ok(compiled(seenFirst).fragmentShader.includes(SPEC_LINE), "so it draws the client's highlight in the preview's own context before the world has ever seen it");
  // Then the world adopts both: the cascades replace the hook, the scan wraps the highlight again.
  for (const m of [onlyWorld, seenFirst]) {
    m.onBeforeCompile = function cascades(shader: Shader) {
      shader.uniforms.CSM_cascades = { value: [] };
    };
    specWrap(m);
  }
  const a = compiled(onlyWorld);
  const b = compiled(seenFirst);
  ok(onlyWorld.customProgramCacheKey() === seenFirst.customProgramCacheKey() && a.fragmentShader === b.fragmentShader && wrapsOn(seenFirst as unknown as Wrappable).join() === 'spec', 'and the world then builds the very program it would have had the preview never touched it: same key, same text');
  const hook = seenFirst.onBeforeCompile;
  for (let i = 0; i < 50; i++) specWrapTree(root);
  ok(seenFirst.onBeforeCompile === hook && (seenFirst.onBeforeCompile as unknown as Record<symbol, unknown>)[SPEC_HOOK] === true, 'a material already wrapped is left with the very hook it had, whatever asks again');
}

// ---------------------------------------------------------------- which materials the scan wraps

{
  ok(SPEC_WRAP === true, "with no localStorage the wrap is on (localStorage['swg.spec'] = 'three' turns it off at load)");
  const plain = standard();
  specWrap(plain);
  ok(wrapsOn(plain as unknown as Wrappable).length === 0, 'a material that says nothing of its highlight (a pack from before format 6) is left exactly as it was');
  const basic = new THREE.MeshBasicMaterial();
  basic.userData.swgSpec = spec('phong');
  specWrap(basic);
  ok(wrapsOn(basic as unknown as Wrappable).length === 0, 'an unlit material has no lights to replace and is left alone');
  const unlit = standard({ swgSpec: spec('phong'), unlit: true });
  specWrap(unlit);
  ok(wrapsOn(unlit as unknown as Wrappable).length === 0, 'and so is one marked unlit');
  const none = standard({ swgSpec: spec('none') });
  specWrap(none);
  ok(wrapsOn(none as unknown as Wrappable).join() === 'spec', 'a material whose shader drew no highlight is wrapped, so it draws none rather than three\'s');
  const phys = new THREE.MeshPhysicalMaterial();
  phys.userData.swgSpec = spec('aniso');
  applySpec(phys, false);
  ok(compiled(phys).fragmentShader.includes(SPEC_LINE), 'a physical material takes it as a standard one does');
}

// ---------------------------------------------------------------- refuses rather than breaks

{
  const warns: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => void warns.push(args.join(' '));
  try {
    const s = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader.replace('#include <lights_fragment_begin>', ''), uniforms: {} } as unknown as Shader;
    const went = injectSpec(s, standard({ swgSpec: spec('phong') }));
    ok(!went && s.fragmentShader === lib.fragmentShader.replace('#include <lights_fragment_begin>', '') && Object.keys(s.uniforms).length === 0, 'a shader with no light loop is left exactly as it was, uniforms and all');
  } finally {
    console.warn = warn;
  }
  ok(warns.length === 1 && warns[0].includes('lights_fragment_begin'), 'and it says so once');
}

console.log(`\nspecular: ${passed} checks passed`);
