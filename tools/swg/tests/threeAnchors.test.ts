// Every place the game matches three's own text or reaches under three, held to the three that is installed.
//
// The game injects into three's shaders by finding a line of three's and writing beside it or in its place, and it
// reads fields three does not document (a material's program records, the light state's version, a shadow's map).
// Every one of those is a bet on three's source staying where it is, and the dangerous kind loses in silence: an
// all-or-nothing replacement that no longer finds its anchor writes nothing, and the game draws three's own look
// with no error anywhere. This test is where an upgrade of three says what moved:
//
//  1. the holds (`src/core/threeHolds.ts`): every piece of three 0.187's lighting the game puts back to 0.185's
//     is found, once, in the installed three; none is found twice; and a three that has moved gets nothing at all;
//  2. the bloom's held blur (`src/core/fx/bloomHold.ts`): three's pass still makes its blur through the method
//     the hold overrides;
//  3. every chunk the game names (`#include <name>` anywhere under `src/`) is one the installed three has, and
//     each chunk the game splices at is still included by the library shader it is spliced in;
//  4. the injections themselves, run in the world's own order over the installed three's physical and depth
//     shaders: the wet look, the detail map, the client's highlight, the leaf card's rule and light, the sway and
//     the trees' gust form, each answering that it went in, with nothing counted as a missing anchor;
//  5. the suites that hold the other injections line by line are all in `test:all` (the ground's tile program,
//     the far rings, the air's ground, the water's current, the grass), so the net has no hole a suite dropped
//     from a script would open;
//  6. the fields under three the game reads, each where three's source still writes it: a material's program
//     records, the program's own fields, the light state's version, the shadow map's parts, the skeleton's bone
//     texture, the key's run of parameters (shaderWatch.test and programCensus.test hold its order), the
//     environment three passes through untouched, the loader's plugin hooks, the batched mesh's draw hook;
//  7. what three does under reversed depth that the game leaves to it: the polygon offset's units turned with
//     the factor, the opaque and transparent sorts turned by the depth it negates, the always test kept;
//  8. every function of three's chunks that any shader text of the game's calls (every string under `src/`), each
//     call handing it a number of arguments a definition of it takes, and each such function's definition pinned as
//     0.187 writes it: an anchor can stay where it is while the function a line beside it calls changes what it
//     takes, and node compiles nothing (the water's mask twins called `computeMultiscattering` as 0.185 declared
//     it, linked in no browser on 0.187, and every suite passed);
//  9. the programs themselves, as three would put them together: each injection above and the water's own hooks
//     (its lit material, both mask twins, the current variant and its twin, with waves and flat), with every
//     `#include` resolved over the installed chunks, three's own light loop and the cascades': no call in the whole
//     text hands a function another count than it is defined with, and every name the game's own lines read is one
//     the program round them declares (three's `radiance`, `material.dfg`, `geometryViewDir`), so a name three
//     renames is said here; and each anchor the water's hook writes at is in three's shader once and is written at.
//
// Run: node tools/swg/tests/threeAnchors.test.ts
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import * as THREE from 'three';
import { declaredNames, glslCallables, glslCalls, glslVariant, miscalls, resolveIncludes, undeclaredNames, type GlslCallables } from './glslScan.ts';
import { CUBE_UV_CHUNK, CUBE_UV_MAPPING, THREE_HOLDS, THREE_HOLD_REPORT, holdAt, planThreeHolds, threeChunkAsShipped } from '../../../src/core/threeHolds.ts';
import { BLOOM_BLUR_METHOD, HeldBloomPass, bloomBlurMaterial185 } from '../../../src/core/fx/bloomHold.ts';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { CSMShader } from 'three/examples/jsm/csm/CSMShader.js';
import { injectWetness } from '../../../src/world/wetness.ts';
import { injectDetail } from '../../../src/world/detailMap.ts';
import { GGX_ANCHOR, SPEC_LINE, SPEC_STATS, injectSpec } from '../../../src/world/specular.ts';
import { injectCard } from '../../../src/world/cardRule.ts';
import { CARD_LIGHT_STATS, injectCardLight, markCardLight } from '../../../src/world/cardLight.ts';
import { SWAY_STATS, injectSway, swayDepthFor } from '../../../src/world/floraSway.ts';
import { TREES_ANCHORS, treesFormText } from '../../../src/world/windTrees.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const read = (p: string): string => readFileSync(join(root, p), 'utf8');
const three = (p: string): string => read(join('node_modules/three', p));
const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
const count = (text: string, s: string): number => text.split(s).length - 1;

// ---------------------------------------------------------------- 1. the holds

{
  ok(THREE.REVISION === '187', `three is 0.187 (REVISION ${THREE.REVISION}): every anchor below is that text's`);
  ok(THREE_HOLD_REPORT.held && THREE_HOLD_REPORT.missing.length === 0 && THREE_HOLD_REPORT.holds === THREE_HOLDS.length, `every one of the ${THREE_HOLDS.length} holds was written as the module loaded`);
  const shipped: Record<string, string> = {};
  for (const h of THREE_HOLDS) shipped[h.chunk] = threeChunkAsShipped(h.chunk)!;
  for (const h of THREE_HOLDS) {
    const text = shipped[h.chunk];
    ok(typeof text === 'string' && holdAt(text, h) >= 0, `hold "${h.id}": its piece of three's ${h.chunk} is where it was (${h.why})`);
    ok(!h.put.includes(h.find) || h.put.length > h.find.length, `hold "${h.id}" puts something else in its place`);
  }
  // Laid over the text as shipped, the plan is the text now in three's chunks: nothing else wrote them.
  const plan = planThreeHolds(shipped);
  ok(plan.missing.length === 0 && Object.keys(plan.chunks).every((name) => plan.chunks[name] === chunks[name]), "laid over three's chunks as shipped, the holds give exactly the chunks three now holds");
  for (const h of THREE_HOLDS) ok(chunks[h.chunk].includes(h.put), `hold "${h.id}": what it puts is in the held ${h.chunk}`);
  // All or none: one piece gone and nothing is written, whichever piece it is.
  for (const h of THREE_HOLDS) {
    const moved = { ...shipped, [h.chunk]: shipped[h.chunk].replace(h.find, `${h.find.slice(0, 8)} /* moved */ ${h.find.slice(8)}`) };
    const p = planThreeHolds(moved);
    assert.ok(p.missing.includes(h.id) && Object.keys(p.chunks).length === 0, `with "${h.id}" moved nothing is held`);
  }
  ok(true, 'a three in which any one piece has moved is given nothing at all, and the plan names the piece');
  // The lines the game's own injections are written against are the held ones.
  const pars = chunks.lights_physical_pars_fragment;
  ok(count(pars, GGX_ANCHOR) === 1, "the held lighting has 0.185's highlight line once, which the client's highlight replaces");
  ok(count(pars, 'vec3 BRDF_GGX_Multiscatter(') === 1 && pars.indexOf('vec3 BRDF_GGX_Multiscatter(') < pars.indexOf('void RE_Direct_Physical('), "and 0.185's highlight function is defined once, before the light function calls it");
  ok(!pars.includes('irradiance * specularBRDF * material.multiScatteringCompensation;') && !pars.includes('irradiance * diffuseBRDF * ( 1.0 - F );') && !pars.includes('irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - singleScattering - multiScattering );'), "none of 0.187's three new energy terms is left in a line that writes a light of the game's (a material with a diffuse roughness, which the game has none of, keeps three's)");
  ok(chunks.lights_physical_fragment.includes('max( roughnessFactor, 0.0525 )') && !chunks.lights_physical_fragment.includes('max( roughnessFactor, 0.045 )'), "the smoothest surface is 0.185's 0.0525");
  // The flat environment layout: the chunk three deleted is back under its name, and its number is nobody else's.
  ok(typeof chunks[CUBE_UV_CHUNK] === 'string' && chunks[CUBE_UV_CHUNK].includes('vec4 textureCubeUV(') && threeChunkAsShipped(CUBE_UV_CHUNK) === undefined, `three no longer ships ${CUBE_UV_CHUNK}, and the holds put 0.185's back`);
  const constants = THREE as unknown as Record<string, unknown>;
  const sameNumber = Object.keys(constants).filter((k) => /Mapping$/.test(k) && constants[k] === CUBE_UV_MAPPING);
  ok(sameNumber.length === 0 && constants.CubeUVReflectionMapping === undefined, `no mapping of three's is ${CUBE_UV_MAPPING}, the number the flat layout's textures carry`);
  const env = three('src/renderers/webgl/WebGLEnvironments.js');
  const pmremAt = env.indexOf('\tfunction getPMREM( texture ) {');
  const pmremEnd = env.indexOf('\n\tfunction ', pmremAt + 1);
  const getPmrem = pmremAt >= 0 ? env.slice(pmremAt, pmremEnd < 0 ? env.length : pmremEnd) : '';
  ok(getPmrem.includes('if ( isEquirectMap || isCubeMap ) {') && /\n\t\treturn texture;\s*\n\t\}\s*$/.test(getPmrem), "three filters only an equirectangular or a cube environment itself, and hands any other texture through as it is (the flat layout's)");
  ok(/envMapMode: HAS_ENVMAP && envMap\.mapping,/.test(three('src/renderers/webgl/WebGLPrograms.js')) && /const HAS_PMREM = [^\n]*isPMREMTexture/.test(three('src/renderers/webgl/WebGLPrograms.js')), "a program is told its environment is a filtered cube only of a texture three marked so, so the flat layout's is keyed as a plain cube and the held chunk reads it");
}

// ---------------------------------------------------------------- 2. the bloom's blur

{
  const proto = UnrealBloomPass.prototype as unknown as Record<string, unknown>;
  ok(typeof proto[BLOOM_BLUR_METHOD] === 'function', `three's bloom pass still has ${BLOOM_BLUR_METHOD}`);
  const src = three('examples/jsm/postprocessing/UnrealBloomPass.js');
  ok(/this\.separableBlurMaterials\.push\( this\._getSeparableBlurMaterial\( kernelSizeArray\[ i \] \) \);/.test(src), 'and its constructor makes each level\'s blur through it, so the override is what is drawn');
  ok(/this\.separableBlurMaterials\[ i \]\.uniforms\[ 'invSize' \]\.value = /.test(src) && /uniforms\[ 'colorTexture' \]\.value = /.test(src) && /uniforms\[ 'direction' \]\.value = /.test(src), 'the pass writes only the three uniforms the held material has');
  ok((HeldBloomPass.prototype as unknown as Record<string, unknown>)[BLOOM_BLUR_METHOD] !== proto[BLOOM_BLUR_METHOD], 'the held pass overrides it');
  const m = bloomBlurMaterial185(6);
  ok(m.defines.KERNEL_RADIUS === 6 && (m.uniforms.gaussianCoefficients.value as number[]).length === 6 && 'invSize' in m.uniforms && 'colorTexture' in m.uniforms && 'direction' in m.uniforms, "the held blur is 0.185's: one coefficient a tap, and the three uniforms the pass writes");
  ok(m.fragmentShader.includes('gaussianCoefficients[KERNEL_RADIUS]') && !m.fragmentShader.includes('KERNEL_PAIRS'), 'with one fetch a tap either side, never a pair read as one');
  m.dispose();
}

// ---------------------------------------------------------------- 3. every chunk the game names

const sources: string[] = [];
(function walk(dir: string): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.ts$/.test(name) && !/\.d\.ts$/.test(name)) sources.push(p);
  }
})(join(root, 'src'));

{
  const named = new Map<string, Set<string>>();
  for (const file of sources) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/#include <([a-z0-9_]+)>/g)) {
      if (!named.has(m[1])) named.set(m[1], new Set());
      named.get(m[1])!.add(relative(root, file).replace(/\\/g, '/'));
    }
  }
  ok(named.size >= 30, `the game names ${named.size} of three's chunks, in ${new Set([...named.values()].flatMap((s) => [...s])).size} files`);
  const gone = [...named.keys()].filter((n) => typeof chunks[n] !== 'string');
  ok(gone.length === 0, `every one is a chunk the installed three has${gone.length ? ` (gone: ${gone.map((n) => `${n} in ${[...named.get(n)!].join(', ')}`).join('; ')})` : ''}`);

  // Where the game splices: the stage of three's library shader each of these includes stands in. A chunk that
  // leaves its shader leaves the splice with nothing to find.
  const lib = THREE.ShaderLib;
  const includes = (text: string, name: string): boolean => text.includes(`#include <${name}>`);
  const SPLICES: [string, 'vertexShader' | 'fragmentShader', string[]][] = [
    ['physical', 'vertexShader', ['common', 'uv_vertex', 'beginnormal_vertex', 'begin_vertex', 'project_vertex', 'worldpos_vertex', 'shadowmap_vertex', 'morphtarget_vertex', 'skinning_vertex', 'skinbase_vertex']],
    ['physical', 'fragmentShader', ['common', 'clipping_planes_fragment', 'map_fragment', 'color_fragment', 'alphatest_fragment', 'roughnessmap_fragment', 'normal_fragment_maps', 'lights_physical_pars_fragment', 'lights_fragment_begin', 'lights_fragment_maps', 'lights_fragment_end', 'opaque_fragment', 'tonemapping_fragment', 'colorspace_fragment', 'fog_fragment', 'dithering_fragment']],
    ['depth', 'vertexShader', ['common', 'begin_vertex', 'project_vertex', 'morphtarget_vertex', 'skinning_vertex', 'skinbase_vertex']],
    ['depth', 'fragmentShader', ['common', 'map_fragment', 'alphatest_fragment']],
  ];
  for (const [shader, stage, list] of SPLICES) {
    const text = lib[shader][stage];
    const lost = list.filter((n) => !includes(text, n));
    ok(lost.length === 0, `three's ${shader} ${stage === 'vertexShader' ? 'vertex' : 'fragment'} shader still includes the ${list.length} chunks the game writes beside${lost.length ? ` (lost: ${lost.join(', ')})` : ''}`);
    const twice = list.filter((n) => count(text, `#include <${n}>`) !== 1);
    ok(twice.length === 0, `and each of them once, so a splice lands in one place${twice.length ? ` (not once: ${twice.join(', ')})` : ''}`);
  }
  // The cascades replace two of three's chunks whole with their own, which the leaf cards' light rewrites again.
  ok(typeof CSMShader.lights_fragment_begin === 'string' && typeof CSMShader.lights_pars_begin === 'string' && typeof chunks.lights_fragment_begin === 'string' && typeof chunks.lights_pars_begin === 'string', "the cascades' two chunks stand in for two of three's own of the same names");
  ok(CSMShader.lights_fragment_begin.includes('material.dfg = texture2D( dfgLUT') === chunks.lights_fragment_begin.includes('material.dfg = texture2D( dfgLUT'), "and the cascades' light loop works the highlight's table out where three's own does (a cascades' chunk from another three would leave the lighting half made)");
}

// ---------------------------------------------------------------- 4. the injections, over the installed text

type Shader = THREE.WebGLProgramParametersWithUniforms;
const shaderOf = (lib: { vertexShader: string; fragmentShader: string; uniforms: Record<string, THREE.IUniform> }): Shader =>
  ({ vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: THREE.UniformsUtils.clone(lib.uniforms), defines: {} }) as unknown as Shader;

/** Each shader an injection below was written into, with the library shader it began as: section 9 puts each together whole. */
const INJECTED: { what: string; lib: 'physical' | 'depth'; shader: Shader; loops: ('three' | 'cascades')[] }[] = [];

{
  const warns: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => void warns.push(args.join(' '));
  try {
    // A world object: the wet look, the detail map, the client's highlight, in the scan's own order.
    const mat = new THREE.MeshStandardMaterial();
    mat.userData.swgSpec = { mode: 'phong', color: [0.5, 0.5, 0.5], power: 20, mask: 'SPEC.a' };
    const s = shaderOf(THREE.ShaderLib.physical);
    const before = { v: s.vertexShader, f: s.fragmentShader };
    injectWetness(s, 'object');
    ok(s.fragmentShader !== before.f && s.vertexShader !== before.v && s.fragmentShader.includes('#define SWG_WET'), "the wet look goes into three's physical shader, both stages");
    ok(injectDetail(s, new THREE.Texture()), 'the detail map goes in after it');
    const missingBefore = SPEC_STATS.missingAnchor;
    ok(injectSpec(s, mat) && s.fragmentShader.includes(SPEC_LINE) && !s.fragmentShader.includes('#include <lights_physical_pars_fragment>') && SPEC_STATS.missingAnchor === missingBefore, "and the client's highlight after that, in place of three's line, with no anchor missed");
    INJECTED.push({ what: "a world object (the wet look, the detail map, the client's highlight)", lib: 'physical', shader: s, loops: ['three', 'cascades'] });

    // A ground of the wet kind: its one more stage is there.
    const g = shaderOf(THREE.ShaderLib.physical);
    const gf = g.fragmentShader;
    injectWetness(g, 'ground');
    ok(g.fragmentShader !== gf && g.fragmentShader.includes('rainRingSlope('), "the ground's wet look, with its rain rings, goes in too");
    INJECTED.push({ what: "a ground of the wet kind", lib: 'physical', shader: g, loops: ['three', 'cascades'] });

    // A leaf card: the rule, then its light over the cascades' loop, then the sway and the trees' gust form.
    const leaf = new THREE.MeshStandardMaterial({ alphaTest: 0.5 });
    leaf.userData.swgCard = { blend: false, emissive: [0, 0, 0] };
    const c = shaderOf(THREE.ShaderLib.physical);
    injectWetness(c, 'object');
    injectSpec(c, leaf);
    ok(injectCard(c, leaf), "the leaf card's rule goes into three's physical shader");
    // The rule writes the light itself for a marked card, over the light loop in three's chunks, which in the game
    // is the cascades' (they replace it as they are made); here the light is handed the cascades' loop outright.
    markCardLight(leaf);
    const cardMissing = CARD_LIGHT_STATS.missingAnchor;
    ok(injectCardLight(c, leaf, CSMShader.lights_fragment_begin) && CARD_LIGHT_STATS.missingAnchor === cardMissing, `and the card's light over the cascades' own light loop, every site of it${CARD_LIGHT_STATS.missing.length ? ` (missing: ${CARD_LIGHT_STATS.missing.join(', ')})` : ''}`);
    leaf.userData.swgSway = { base: 0.2, height: 6, axis: [0, 0], radius: 0.4, phase: 0 };
    const swayMissing = SWAY_STATS.missingAnchor;
    ok(injectSway(c, leaf) && SWAY_STATS.missingAnchor === swayMissing, 'and the sway after both');
    ok(TREES_ANCHORS.length > 0 && treesFormText(c.vertexShader) !== null, "and the trees' gust form finds every one of its anchors in the swaying vertex stage");
    // (The card's light was handed the cascades' loop and wrote it in outright, so only that loop is its program's.)
    INJECTED.push({ what: "a leaf card (the wet look, the highlight, the card's rule and light, the sway)", lib: 'physical', shader: c, loops: ['cascades'] });
    INJECTED.push({ what: "a leaf card in the trees' gust form", lib: 'physical', shader: { ...c, vertexShader: treesFormText(c.vertexShader)! } as Shader, loops: ['cascades'] });

    // The sway's shadow: three's depth shader through the depth twin's own hook.
    const depth = swayDepthFor(leaf);
    const d = shaderOf(THREE.ShaderLib.depth);
    const dv = d.vertexShader;
    (depth.onBeforeCompile as unknown as (shader: Shader, renderer: unknown) => void)(d, null);
    ok(d.vertexShader !== dv && SWAY_STATS.missingAnchor === swayMissing, "the swaying shadow goes into three's depth shader");
    INJECTED.push({ what: "a swaying leaf's shadow", lib: 'depth', shader: d, loops: ['three', 'cascades'] });
    depth.dispose();
    leaf.dispose();
    mat.dispose();
  } finally {
    console.warn = warn;
  }
  ok(warns.length === 0, `none of them said an anchor was missing${warns.length ? `: ${warns.join(' | ')}` : ''}`);
}

// ---------------------------------------------------------------- 5. the suites that hold the rest

{
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  const expand = (name: string, seen = new Set<string>()): string => {
    if (seen.has(name)) return '';
    seen.add(name);
    return (pkg.scripts[name] ?? '').split('&&').map((c) => {
      const m = /^\s*npm run (\S+)\s*$/.exec(c);
      return m ? expand(m[1], seen) : c;
    }).join(' && ');
  };
  const all = expand('test:all');
  // Each of these runs one of the game's injections against the installed three's own text, line by line.
  const HOLDERS: [string, string][] = [
    ['specular.test.ts', "the client's highlight"],
    ['wetness.test.ts', 'the wet look'],
    ['cardRule.test.ts', "the leaf card's rule"],
    ['cardBacks.test.ts', "the card's mirrored backs"],
    ['cardLight.test.ts', "the card's light, the five sites of the cascades' loop"],
    ['swayShader.test.ts', 'the sway and its depth twins'],
    ['windTrees.test.ts', "the trees' gust form"],
    ['groundShader.test.ts', "the ground's tile program"],
    ['groundDetail.test.ts', "the ground's side pictures and relief"],
    ['horizonShaders.test.ts', "the far rings' program"],
    ['horizonCardField.test.ts', 'the far tree cards'],
    ['grassShader.test.ts', 'the grass'],
    ['airGround.test.ts', "the air's ground variant"],
    ['waterCurrent.test.ts', "the water's current variant"],
    ['personKeys.test.ts', "a person's superset of maps"],
    ['shaderWatch.test.ts', "the program key's run, field by field"],
    ['programCensus.test.ts', "the program key's run, as the census reads it"],
    ['reversedDepth.test.ts', 'the draw order and the depth tests under reversed depth'],
    ['threeAnchors.test.ts', 'this file'],
  ];
  const absent = HOLDERS.filter(([file]) => !all.includes(`tools/swg/tests/${file}`));
  ok(absent.length === 0, `the ${HOLDERS.length} suites that hold an injection or a reading of three's are all run by test:all${absent.length ? ` (not run: ${absent.map(([f, what]) => `${f}, ${what}`).join('; ')})` : ''}`);
}

// ---------------------------------------------------------------- 6. the fields under three

{
  const renderer = three('src/renderers/WebGLRenderer.js');
  const fields = ['programs', 'currentProgram', 'uniforms', '__version', 'lightsStateVersion'];
  const unwritten = fields.filter((f) => !new RegExp(`materialProperties\\.${f} = `).test(renderer));
  ok(unwritten.length === 0, `three's renderer still keeps a material's ${fields.join(', ')} where the game reads them${unwritten.length ? ` (not written: ${unwritten.join(', ')})` : ''}`);
  ok(/programs = new Map\(\);\s*materialProperties\.programs = programs;/.test(renderer) && /programs\.set\( programCacheKey, program \);/.test(renderer), "a material's programs are a map keyed by the cache key");
  ok(/needsProgramVariant = true;/.test(renderer) && /function getProgramVariant\(/.test(renderer), 'a change of tone mapping or colour space alone takes a variant already built, never a new key (0.187)');
  ok(/info\.render\.frame \+\+/.test(renderer) && /this\.info = info;|_this\.info = info;/.test(renderer), "the renderer's own counts are where the frame report reads them");

  const program = three('src/renderers/webgl/WebGLProgram.js');
  const own = ['this.name = ', 'this.id = ', 'this.cacheKey = ', 'this.usedTimes = ', 'this.program = ', 'this.getUniforms = ', 'this.isReady = ', 'self.diagnostics = '];
  const lost = own.filter((f) => !program.includes(f));
  ok(lost.length === 0, `a program still carries its name, id, key, use count, GL program, uniforms, readiness and diagnostics${lost.length ? ` (lost: ${lost.join(', ')})` : ''}`);
  ok(/COMPLETION_STATUS_KHR/.test(program), "and answers whether it is linked through the parallel compile extension's own status");

  const lights = three('src/renderers/webgl/WebGLLights.js');
  ok(/state\.version = nextVersion \+\+;/.test(lights) && /let nextVersion = 0;/.test(lights), "the light state's version is one counter for every state, moved when a pass's counts change (the passes' own scenes rest on it)");
  const states = three('src/renderers/webgl/WebGLRenderStates.js');
  ok(/function get\( scene, renderCallDepth = 0 \)/.test(states), 'and a render state is kept a scene object and depth');

  const shadow = three('src/renderers/webgl/WebGLShadowMap.js');
  ok(/shadow\.map = new WebGLRenderTarget\(/.test(shadow) && /shadow\.map\.depthTexture = new DepthTexture\(/.test(shadow) && /shadow\.map\.depthTexture\.compareFunction = /.test(shadow), "a filtered shadow's map is a target whose depth texture, with its compare, is what the effects and the grass sample");
  ok(/if \( shadow\.autoUpdate === false && shadow\.needsUpdate === false \) continue;/.test(shadow) && /shadow\.needsUpdate = false;/.test(shadow), "a light whose shadow asks for no update is stepped over whole, and three clears the ask as it draws (the cascades' cadence)");
  ok(/object\.onBeforeShadow\( renderer, object, camera, shadowCamera, geometry, depthMaterial, group \);/.test(shadow) && /object\.onAfterShadow\( renderer, object, camera, shadowCamera, geometry, depthMaterial, group \);/.test(shadow), 'the shadow hooks are handed the shadow camera fourth and the depth material sixth');
  ok(/const customMaterial = \( light\.isPointLight === true \) \? object\.customDistanceMaterial : object\.customDepthMaterial;/.test(shadow) && /result\.map = material\.map;/.test(shadow) && /result\.alphaMap = material\.alphaMap;/.test(shadow) && /result\.alphaTest = /.test(shadow), "a caster's own depth material is used as it stands, and three's shared one takes the caster's picture, alpha picture and cut");
  ok(shadow.includes('const layers = ( shadow.camera.layers.mask & 0xFFFFFFFE ) !== 0 ? shadow.camera.layers : camera.layers;') && !sources.some((f) => /shadow\.camera\.layers/.test(readFileSync(f, 'utf8'))), "casters are chosen by the layers of the camera the pass was asked with, since no light of the game's gives its shadow camera layers of its own (0.187 would choose by those)");

  const skeleton = three('src/objects/Skeleton.js');
  ok(/\tupdate\(\) \{/.test(skeleton) && /const boneTexture = this\.boneTexture;/.test(skeleton) && /boneTexture\.needsUpdate = true;/.test(skeleton) && /computeBoneTexture\(\) \{/.test(skeleton) && /this\.boneMatrices = /.test(skeleton), "a skeleton's update writes its bone matrices and marks its bone texture, which the once-a-frame patch wraps");

  const programs = three('src/renderers/webgl/WebGLPrograms.js');
  ok(/function getProgramCacheKey\( parameters \)/.test(programs) && /array\.push\( parameters\.customProgramCacheKey \);/.test(programs) && /customProgramCacheKey: material\.customProgramCacheKey\(\)/.test(programs), "a material's own key is the last field of its program's");
  ok(/morphTargetsCount: morphTargetsCount,|morphTargetsCount,/.test(programs) && /envMapMode: HAS_ENVMAP && envMap\.mapping,/.test(programs), 'and the morph count and the environment kind are in it');

  const loader = three('examples/jsm/loaders/GLTFLoader.js');
  const hooks = ['afterRoot', 'beforeRoot', 'loadTexture', 'loadMaterial', 'extendMaterialParams', 'getMaterialType', 'loadMesh', 'loadNode'];
  const unasked = hooks.filter((h) => !new RegExp(`ext\\.${h} && ext\\.${h}\\(`).test(loader));
  ok(unasked.length === 0, `the loader still asks its plugins for ${hooks.join(', ')}${unasked.length ? ` (not asked: ${unasked.join(', ')})` : ''}`);
  ok(/register\( callback \) \{/.test(loader) && /this\.associations = new Map\(\);/.test(loader) && /loadImageSource\( sourceIndex, loader \) \{/.test(loader) && /this\.sourceCache = \{\};/.test(loader), 'and keeps its plugin list, its associations and its image source cache where the shared pictures read them');

  const batched = three('src/objects/BatchedMesh.js');
  ok(batched.includes('onBeforeShadow( renderer, object, camera, shadowCamera, geometry, depthMaterial/* , group */ ) {') && /this\._multiDrawCounts = /.test(batched) && /this\._matricesTexture = /.test(batched), "a batched mesh still culls and sorts its copies in the shadow hook, by the shadow camera it is handed");
  ok(/renderer\.isWebGPURenderer/.test(batched), 'and asks the renderer it is handed which kind it is, so a stand-in for one must be an object');

  const csm = three('examples/jsm/csm/CSM.js');
  const parts = ['this.lights = [];', 'this.frustums = [];', 'this.breaks = [];', 'this.mainFrustum = new CSMFrustum', 'this.shaders = new Map();', 'updateFrustums() {', 'setupMaterial( material ) {', 'material.onBeforeCompile = function ( shader ) {', "material.defines.USE_CSM = 1;"];
  const csmLost = parts.filter((p) => !csm.includes(p));
  ok(csmLost.length === 0, `the cascades keep their lights, frustums, breaks and shader records, and put their define and their hook on a material${csmLost.length ? ` (lost: ${csmLost.join(' | ')})` : ''}`);
}

// ---------------------------------------------------------------- 7. reversed depth, left to three

{
  const state = three('src/renderers/webgl/WebGLState.js');
  ok(/if \( depthBuffer\.getReversed\(\) \) \{\s*factor = - factor;\s*units = - units;\s*\}/.test(state), "three turns a polygon offset's factor and its units round under reversed depth, so the game hands both as written");
  const lists = three('src/renderers/webgl/WebGLRenderLists.js');
  ok(/function push\( object, geometry, material, groupOrder, z, group, camera \)/.test(lists) && /camera\.reversedDepth|reversedDepth/.test(lists), 'and the draw lists are handed the camera, whose reversed depth they turn the sort by, so the game sets no sort of its own');
  const utils = three('src/utils.js');
  ok(/\[ AlwaysDepth \]: AlwaysDepth,/.test(utils) && /\[ NeverDepth \]: NeverDepth,/.test(utils) && /\[ LessEqualDepth \]: GreaterEqualDepth,/.test(utils), 'the always and never tests stay themselves and only less and greater swap');
  const main = read('src/main.ts');
  ok(!/setOpaqueSort|setTransparentSort/.test(main) && !/REVERSED_DEPTH \? -/.test(read('src/world/surfaces.ts')) && !/REVERSED_DEPTH \? -/.test(read('src/world/marks.ts')) && !/REVERSED_DEPTH \? -/.test(read('src/world/lava.ts')) && !/REVERSED_DEPTH \? -/.test(read('src/core/fx/geometry.ts')), 'the game turns neither the sorts nor an offset itself any more: turned twice, each would be the wrong way round');
}

// ---------------------------------------------------------------- 8. three's functions the game's shader text calls

/** Everything three's chunks as shipped (before any hold) and the cascades' two define that a shader may call. */
const threeCallables: GlslCallables = { counts: new Map(), signatures: new Map() };
for (const name of Object.keys(chunks)) {
  const text = threeChunkAsShipped(name);
  if (typeof text === 'string') glslCallables(text, threeCallables);
}
for (const text of Object.values(CSMShader as unknown as Record<string, unknown>)) if (typeof text === 'string') glslCallables(text, threeCallables);

/**
 * Each function or macro of three's chunks that shader text of the game's calls, as three 0.187 defines it: what it
 * answers and what it takes, in order (`const`, `in` and precision left out; a macro by its count). A name the game's
 * own text defines as well is not three's to pin and is held by its count alone: 0.185's functions the holds put
 * back (`BRDF_GGX_Multiscatter`, the flat environment's readers), and any a shader of the game's own writes for itself.
 * When three moves one of these, look at every call of it the game makes before moving the pin.
 */
const THREE_CALLED: Readonly<Record<string, readonly string[]>> = {
  // The water's mask twins (src/world/water.ts): the weight three's own indirect light gives the environment.
  computeMultiscattering: ['void(vec2, vec3, float, inout vec3, inout vec3)'],
  max3: ['float(vec3)'],
  // The leaf cards' light and their shadow lookup (cardLight.ts, leafShadow.ts).
  BRDF_Lambert: ['vec3(vec3)'],
  getHemisphereLightIrradiance: ['vec3(HemisphereLight, vec3)'],
  getDirectionalLightInfo: ['void(DirectionalLight, out IncidentLight)'],
  getShadow: ['float(sampler2D, vec2, float, float, float, vec4)', 'float(sampler2DShadow, vec2, float, float, float, vec4)'],
  // The wet look's and the card's Fresnel lines (wetness.ts, cardRule.ts), and the held text.
  saturate: ['macro(1)'],
  // The doll's own output pass (src/ui/previewDof.ts): three's tone curves and its sRGB transfer.
  ACESFilmicToneMapping: ['vec3(vec3)'],
  AgXToneMapping: ['vec3(vec3)'],
  CineonToneMapping: ['vec3(vec3)'],
  LinearToneMapping: ['vec3(vec3)'],
  NeutralToneMapping: ['vec3(vec3)'],
  ReinhardToneMapping: ['vec3(vec3)'],
  sRGBTransferOETF: ['vec4(vec4)'],
  // 0.185's lines the holds put back (src/core/threeHoldText.ts) and 0.185's environment filter (pmrem185.ts) call these of 0.187's.
  BRDF_GGX: ['vec3(vec3, vec3, vec3, PhysicalMaterial)'],
  interleavedGradientNoise: ['float(vec2)'],
  vogelDiskSample: ['vec2(int, int, float)'],
  pow4: ['float(float)'],
  transformDirectionByInverseViewMatrix: ['vec3(vec3, mat4)'],
  transformNormalByInverseViewMatrix: ['vec3(vec3, mat4)'],
  equirectUv: ['vec2(vec3)'],
};

{
  // Every string the game's source writes, as the compiler reads it: a shader's text is a template or a plain string
  // (a line an injection finds or puts), and whatever stands in a `${}` is a value, read as one name.
  const literals: { file: string; text: string }[] = [];
  for (const file of sources) {
    const source = readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, false);
    const rel = relative(root, file).replace(/\\/g, '/');
    const visit = (n: ts.Node): void => {
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) literals.push({ file: rel, text: n.text });
      else if (ts.isTemplateExpression(n)) literals.push({ file: rel, text: [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join(' _ ') });
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  ok(literals.length > 5000, `the game's source holds ${literals.length} strings in ${sources.length} files, every one read for a call into three's shader text`);

  // What the game's own shader text defines: a function of the same name as one of three's, in a shader of its own.
  const own: GlslCallables = { counts: new Map(), signatures: new Map() };
  for (const l of literals) if (l.text.includes('{')) glslCallables(l.text, own);

  const called = new Map<string, Set<string>>();
  const wrong: string[] = [];
  for (const l of literals) {
    // A name hard against its parenthesis, as three and the game both write a call: prose in a hint is not one.
    for (const c of glslCalls(l.text, threeCallables, true)) {
      if (!called.has(c.name)) called.set(c.name, new Set());
      called.get(c.name)!.add(l.file);
      if (!threeCallables.counts.get(c.name)!.has(c.args) && !own.counts.get(c.name)?.has(c.args)) {
        wrong.push(`${l.file}: ${c.text} hands ${c.args} argument(s), three's takes ${[...threeCallables.counts.get(c.name)!].sort().join(' or ')}`);
      }
    }
  }
  ok(wrong.length === 0, `every call the game's shader text makes of a function of three's hands it as many arguments as three's definition takes${wrong.length ? `:\n     ${[...new Set(wrong)].join('\n     ')}` : ''}`);

  const threes = [...called.keys()].filter((n) => !own.counts.has(n)).sort();
  const pinned = Object.keys(THREE_CALLED).sort();
  const unpinned = threes.filter((n) => !(n in THREE_CALLED));
  const uncalled = pinned.filter((n) => !threes.includes(n));
  ok(unpinned.length === 0, `each of the ${threes.length} functions and macros of three's the game's shader text calls is pinned here${unpinned.length ? `; not pinned: ${unpinned.map((n) => `${n}: ${JSON.stringify(threeCallables.signatures.get(n))} (${[...called.get(n)!].join(', ')})`).join('; ')}` : ''}`);
  ok(uncalled.length === 0, `and none is pinned that nothing calls any more${uncalled.length ? ` (${uncalled.join(', ')})` : ''}`);
  const moved = pinned.filter((n) => JSON.stringify(threeCallables.signatures.get(n) ?? []) !== JSON.stringify(THREE_CALLED[n]));
  ok(moved.length === 0, `each is defined as it was when the game's calls were written${moved.length ? `; moved: ${moved.map((n) => `${n}: was ${JSON.stringify(THREE_CALLED[n])}, is ${JSON.stringify(threeCallables.signatures.get(n) ?? 'gone')} (called in ${[...(called.get(n) ?? [])].join(', ')})`).join('; ')}` : ''}`);
  ok(called.has('computeMultiscattering') && 'computeMultiscattering' in THREE_CALLED && [...called.get('computeMultiscattering')!].join() === 'src/world/water.ts', "computeMultiscattering is among them, called by the water's mask twins");
  const shared = [...called.keys()].filter((n) => own.counts.has(n)).sort();
  console.log(`     (names three's chunks and the game's own shader text both define, held by count alone: ${shared.join(', ') || 'none'})`);
  // The held highlight is the game's own definition now (0.187 has none), and its one caller is the held light line.
  ok(!threeCallables.counts.has('BRDF_GGX_Multiscatter') && own.counts.get('BRDF_GGX_Multiscatter')?.has(4) === true, "three 0.187 ships no BRDF_GGX_Multiscatter: the one the holds put back is the game's to keep in step with its callers (section 9 puts the programs together)");
}

// ---------------------------------------------------------------- 9. the programs, put together whole

/** Three's chunks as it ships them, before any hold. */
const shippedChunks: Record<string, string | undefined> = {};
for (const name of Object.keys(chunks)) shippedChunks[name] = threeChunkAsShipped(name);
const cascadesTwo = { lights_fragment_begin: CSMShader.lights_fragment_begin, lights_pars_begin: CSMShader.lights_pars_begin };
/**
 * The chunks a program is put together from, two ways: over three's own light loop, and (as in the game, once the
 * cascades are made) over the cascades' two in place of three's. `held` is what the game builds from; `shipped` is
 * three alone, which is what the game's own lines are told apart from.
 */
const LOOPS = {
  three: { name: "three's light loop", held: chunks as Readonly<Record<string, string | undefined>>, shipped: shippedChunks as Readonly<Record<string, string | undefined>> },
  cascades: { name: "the cascades' light loop", held: { ...chunks, ...cascadesTwo } as Readonly<Record<string, string | undefined>>, shipped: { ...shippedChunks, ...cascadesTwo } as Readonly<Record<string, string | undefined>> },
} as const;
type Loop = keyof typeof LOOPS;

/**
 * What three's renderer declares ahead of every shader it builds, read out of its own source (`WebGLProgram.js`): its
 * uniforms and attributes, every name it `#define`s or counts lights by, and what its loop unroller writes.
 */
const prefixNames = (() => {
  const src = three('src/renderers/webgl/WebGLProgram.js');
  const names = new Set<string>(['UNROLLED_LOOP_INDEX', 'gl_FragColor', 'gl_FragDepth', 'gl_PointCoord', 'gl_PointSize', 'location']);
  for (const m of src.matchAll(/\b(?:uniform|attribute|in|out)\s+(?:(?:highp|mediump|lowp)\s+)?\w+\s+(\w+)\s*;/g)) names.add(m[1]);
  for (const m of src.matchAll(/#define\s+(\w+)/g)) names.add(m[1]);
  for (const m of src.matchAll(/\bNUM_[A-Z_]+\b/g)) names.add(m[0]);
  // And what the cascades define on every material they set up (the count of them, read in the light loop).
  for (const m of three('examples/jsm/csm/CSM.js').matchAll(/\bdefines\.(\w+)/g)) names.add(m[1]);
  return names;
})();
ok(['cameraPosition', 'viewMatrix', 'modelMatrix', 'isOrthographic', 'position', 'normal', 'uv', 'NUM_DIR_LIGHTS'].every((n) => prefixNames.has(n)), "three's program prefix still declares the camera's place, the matrices and the attributes the game's lines read");

/**
 * Three's features nothing the game draws asks for (`threeHolds.ts` says the same of its holds): their `#ifdef`s are
 * never taken when a program is read by scope. With iridescence, three names `computeMultiscattering` otherwise.
 */
const NOT_DRAWN = new Set(['USE_IRIDESCENCE', 'USE_SHEEN', 'USE_CLEARCOAT', 'USE_ANISOTROPY', 'USE_TRANSMISSION', 'USE_DISPERSION', 'USE_RETROREFLECTION', 'USE_DIFFUSE_ROUGHNESS']);

/** The lines of `hooked` that are not lines of `shipped`: what the game wrote into a shader of three's. */
function linesWritten(shipped: string, hooked: string): string {
  const left = new Map<string, number>();
  for (const line of shipped.split('\n')) left.set(line, (left.get(line) ?? 0) + 1);
  const out: string[] = [];
  for (const line of hooked.split('\n')) {
    const n = left.get(line) ?? 0;
    if (n > 0) left.set(line, n - 1);
    else out.push(line);
  }
  return out.join('\n');
}

/** The fields of a struct the text declares, by name. */
function structFields(glsl: string, struct: string): Set<string> {
  const out = new Set<string>();
  const body = new RegExp(`struct\\s+${struct}\\s*\\{([^}]*)\\}`).exec(glsl)?.[1] ?? '';
  for (const m of body.replace(/^\s*#[^\n]*/gm, '').matchAll(/\b(\w+)\s*(?:\[[^\]]*\])?\s*;/g)) out.add(m[1]);
  return out;
}

/**
 * One stage of one program, put together whole as three would (every `#include` resolved): nothing it includes is
 * missing; and in the lines that are the game's (the whole text less three's own shader put together from three's own
 * chunks: every injection, and every line a hold put back) no call hands a function a count none of its definitions
 * takes, and no name is read that the whole does not declare. Three's own lines are not judged: it ships branches the
 * game never compiles. Answers what is wrong, in words; nothing when it is sound.
 */
function programFaults(shipped: string, hooked: string, loop: Loop): string[] {
  const faults: string[] = [];
  const missing: string[] = [];
  const whole = resolveIncludes(hooked, LOOPS[loop].held, missing);
  if (missing.length) faults.push(`includes a chunk three has not got: ${[...new Set(missing)].join(', ')}`);
  const written = linesWritten(resolveIncludes(shipped, LOOPS[loop].shipped), whole);
  for (const m of miscalls(written, glslCallables(whole))) faults.push(`calls ${m}`);
  const known = declaredNames(whole, new Set(prefixNames));
  for (const m of whole.matchAll(/^[ \t]*#[ \t]*define[ \t]+(\w+)/gm)) known.add(m[1]);
  // A varying, a uniform or an output is declared after a qualifier the scan's types do not start with; a struct by
  // its own name, and a variable of a struct's type after it.
  for (const m of whole.matchAll(/\b(?:varying|uniform|in|out)\s+(?:(?:highp|mediump|lowp|flat)\s+)*\w+\s+(\w+)/g)) known.add(m[1]);
  const structs = [...whole.matchAll(/\bstruct\s+(\w+)/g)].map((m) => m[1]);
  for (const s of structs) {
    known.add(s);
    for (const m of whole.matchAll(new RegExp(`\\b${s}\\s+(\\w+)\\s*[;=,)[]`, 'g'))) known.add(m[1]);
  }
  const unread = undeclaredNames(written, known);
  if (unread.length) faults.push(`reads names nothing in the program declares: ${unread.join(', ')}`);
  const fields = structFields(whole, 'PhysicalMaterial');
  if (fields.size) {
    const lost = new Set<string>();
    for (const m of written.replace(/\/\/[^\n]*/g, '').matchAll(/\bmaterial\.([A-Za-z_]\w*)/g)) if (!fields.has(m[1])) lost.add(m[1]);
    if (lost.size) faults.push(`reads fields three's material has not got: ${[...lost].join(', ')}`);
  }
  // The scan above takes a name declared anywhere for declared everywhere, and three names a function's parameter
  // `radiance` and a local of `main()` `radiance` alike. So the lines the game wrote into `main()` are held again by
  // scope: each name they read is declared in `main()` itself or outside every function, never only inside another.
  // Read one variant at a time, since a function three writes two ways shares one body between two openings: every
  // `#ifdef` of the text taken (its shadows, its maps), and then the same with the game's own not taken (the lit
  // water beside its mask twin).
  const mine = new Set<string>();
  for (const m of written.matchAll(/^[ \t]*#[ \t]*ifn?def[ \t]+(\w+)/gm)) mine.add(m[1]);
  const every = new Set<string>();
  for (const m of whole.matchAll(/^[ \t]*#[ \t]*ifn?def[ \t]+(\w+)/gm)) if (!NOT_DRAWN.has(m[1])) every.add(m[1]);
  const base = resolveIncludes(shipped, LOOPS[loop].shipped);
  for (const defined of [every, new Set([...every].filter((n) => !mine.has(n)))]) {
    const text = glslVariant(whole, defined);
    const at = text.indexOf('void main()');
    if (at < 0 || at !== text.lastIndexOf('void main()')) {
      faults.push('has no one main()');
      break;
    }
    // Everything before main() that stands outside every brace and every parenthesis: what a line of main() may read.
    let depth = 0;
    let outside = '';
    for (const ch of text.slice(0, at).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ').replace(/^[ \t]*#[^\n]*/gm, ' ')) {
      // A group is kept as its two brackets with nothing between them: `vec2 name() {}` still names a function.
      if (ch === '{' || ch === '(') {
        if (depth === 0) outside += ch;
        depth++;
      } else if (ch === '}' || ch === ')') {
        depth--;
        if (depth === 0) outside += ch;
      } else if (depth === 0 || ch === '\n') outside += ch;
    }
    if (depth !== 0) {
      faults.push(`could not be read by scope (braces off by ${depth} before main)`);
      break;
    }
    const body = text.slice(at);
    const scope = declaredNames(`${outside}\n${body}`, new Set(prefixNames));
    for (const m of whole.matchAll(/^[ \t]*#[ \t]*define[ \t]+(\w+)/gm)) scope.add(m[1]);
    for (const m of outside.matchAll(/\b(?:varying|uniform|in|out)\s+(?:(?:highp|mediump|lowp|flat)\s+)*\w+\s+(\w+)/g)) scope.add(m[1]);
    for (const s of structs) {
      scope.add(s);
      for (const m of `${outside}\n${body}`.matchAll(new RegExp(`\\b${s}\\s+(\\w+)\\s*[;=,)[]`, 'g'))) scope.add(m[1]);
    }
    const inMain = linesWritten(`${glslVariant(base, defined)}\n${text.slice(0, at)}`, body);
    const lost = undeclaredNames(inMain, scope);
    if (lost.length) faults.push(`reads, in main(), names declared neither there nor outside every function: ${lost.join(', ')}`);
  }
  return faults;
}

{
  // The injections of section 4, each put together over three's own light loop and over the cascades'.
  for (const { what, lib, shader, loops } of INJECTED) {
    const shipped = THREE.ShaderLib[lib];
    const faults: string[] = [];
    for (const loop of loops) {
      for (const stage of ['vertexShader', 'fragmentShader'] as const) {
        for (const f of programFaults(shipped[stage], shader[stage], loop)) faults.push(`${stage === 'vertexShader' ? 'vertex' : 'fragment'}, ${LOOPS[loop].name}: ${f}`);
      }
    }
    ok(faults.length === 0, `${what}, put together whole: every call matches a definition and every name its lines read is declared${faults.length ? `:\n     ${[...new Set(faults)].join('\n     ')}` : ''}`);
  }
}

{
  // The water. Its module names its neighbours without an extension, so it is loaded through the off-proof's loader
  // (`airLoader.mjs`), registered here, after every import above was resolved by node's own rule.
  const SRC = join(root, 'src');
  register(pathToFileURL(join(here, 'airLoader.mjs')).href, import.meta.url, { data: { roots: [SRC], packageBase: join(root, 'package.json') } });
  const load = async (p: string): Promise<Record<string, unknown>> => (await import(pathToFileURL(join(SRC, p)).href)) as Record<string, unknown>;
  const W = (await load('world/water.ts')) as typeof import('../../../src/world/water.ts');
  const WL = (await load('world/waterLook.ts')) as typeof import('../../../src/world/waterLook.ts');
  const waterText = read('src/world/water.ts').replace(/\r\n/g, '\n');
  const physical = THREE.ShaderLib.physical;

  // Where the water's hook writes: every `.replace(` of its one function, its anchor a plain string, by stage.
  const from = waterText.indexOf('function plainWater(');
  const body = waterText.slice(from, waterText.indexOf('\n}\n', from));
  const cut = body.indexOf('shader.fragmentShader = shader.fragmentShader');
  ok(from >= 0 && cut > 0 && body.indexOf('shader.vertexShader = shader.vertexShader') > 0 && body.indexOf('shader.vertexShader = shader.vertexShader') < cut, "the water's hook writes its vertex stage and then its fragment stage, each one chain of replacements");
  const anchorsOf = (part: string): { anchors: string[]; replaces: number } => ({
    anchors: [...part.matchAll(/\.replace\(\s*(?:\/\/[^\n]*\n\s*)*'([^'\n]+)',/g)].map((m) => m[1]),
    replaces: count(part, '.replace('),
  });
  const stages = { vertexShader: anchorsOf(body.slice(0, cut)), fragmentShader: anchorsOf(body.slice(cut)) };
  ok(stages.vertexShader.anchors.length === stages.vertexShader.replaces && stages.fragmentShader.anchors.length === stages.fragmentShader.replaces && stages.vertexShader.replaces >= 2 && stages.fragmentShader.replaces >= 6, `every replacement the water's hook makes names its anchor outright: ${stages.vertexShader.replaces} in the vertex stage, ${stages.fragmentShader.replaces} in the fragment stage`);
  for (const stage of ['vertexShader', 'fragmentShader'] as const) {
    const off = stages[stage].anchors.filter((a) => count(physical[stage], a) !== 1);
    ok(off.length === 0, `each anchor of the water's ${stage === 'vertexShader' ? 'vertex' : 'fragment'} stage is in three's physical shader exactly once (${stages[stage].anchors.join(', ')})${off.length ? `; not once: ${off.join(', ')}` : ''}`);
  }
  /** The first line with anything on it after `anchor`. */
  const lineAfter = (text: string, anchor: string): string => text.slice(text.indexOf(anchor) + anchor.length).split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';

  const warns: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => void warns.push(args.join(' '));
  let variants = 0;
  const unwritten: string[] = [];
  const faults: string[] = [];
  let maskCall = '';
  let lightCall = '';
  let tableFirst = true;
  try {
    const look = WL.waterLookFor(null, null, { color: 0x335577, opacity: 0.6 } as never);
    for (const waves of [true, false]) {
      const lit = W.createWaterMaterial(look, waves);
      const air = W.createWaterAirMaterial(lit);
      const set: [string, THREE.Material][] = [
        ['lit', lit],
        ['mask (back)', W.createWaterMaskMaterial(lit, THREE.BackSide)],
        ['mask (front)', W.createWaterMaskMaterial(lit, THREE.FrontSide)],
        ['current', air],
        ["current's mask", W.createWaterMaskMaterial(air, THREE.FrontSide)],
      ];
      for (const [name, mat] of set) {
        const which = `the water's ${name}, ${waves ? 'waves' : 'flat'}`;
        const s = { vertexShader: physical.vertexShader, fragmentShader: physical.fragmentShader, uniforms: {}, defines: {} } as unknown as Shader;
        (mat.onBeforeCompile as unknown as (shader: Shader, renderer: unknown) => void)(s, null);
        variants++;
        for (const stage of ['vertexShader', 'fragmentShader'] as const) {
          // Written at: what follows each anchor is no longer what three had there.
          for (const a of stages[stage].anchors) {
            if (count(s[stage], a) < 1 || lineAfter(s[stage], a) === lineAfter(physical[stage], a)) unwritten.push(`${which}: nothing written at ${a}`);
          }
          for (const loop of ['three', 'cascades'] as const) {
            for (const f of programFaults(physical[stage], s[stage], loop)) faults.push(`${which}, ${stage === 'vertexShader' ? 'vertex' : 'fragment'}, ${LOOPS[loop].name}: ${f}`);
          }
        }
        // The mask's weight of the environment, beside three's own of it in the same program.
        for (const loop of ['three', 'cascades'] as const) {
          const whole = resolveIncludes(s.fragmentShader, LOOPS[loop].held);
          const calls = glslCalls(whole, threeCallables).filter((c) => c.name === 'computeMultiscattering').map((c) => c.text.replace(/\s+/g, ''));
          const mask = calls.find((c) => c.includes('fxSingle')) ?? '';
          const light = calls.find((c) => c.includes('singleScatteringDielectric')) ?? '';
          if (!maskCall) [maskCall, lightCall] = [mask, light];
          if (mask !== maskCall || light !== lightCall || !mask || !light) faults.push(`${which}: the mask's call of computeMultiscattering is not the one every variant makes (${mask || 'none'})`);
          const table = whole.indexOf('material.dfg = texture2D( dfgLUT');
          if (table < 0 || table > whole.indexOf('fxSingle, fxMulti')) tableFirst = false;
        }
        mat.dispose();
      }
    }
  } finally {
    console.warn = warn;
  }
  ok(variants === 10 && unwritten.length === 0, `the water's hook writes at every one of its anchors, in each of its ${variants} variants (lit, both mask twins, the current and its twin; waves and flat)${unwritten.length ? `:\n     ${[...new Set(unwritten)].join('\n     ')}` : ''}`);
  ok(warns.length === 0, `and its current variant finds its lines${warns.length ? `: ${warns.join(' | ')}` : ''}`);
  ok(faults.length === 0, `each put together whole, over three's own light loop and the cascades': every call matches a definition (the mask's of three's computeMultiscattering among them) and every name the water's lines read is one the program declares${faults.length ? `:\n     ${[...new Set(faults)].join('\n     ')}` : ''}`);
  const args = (call: string): string[] => call.slice(call.indexOf('(') + 1, -1).split(',');
  ok(maskCall !== '' && lightCall !== '' && args(maskCall).length === 5 && args(maskCall).slice(0, 3).join() === args(lightCall).slice(0, 3).join(), `the mask weighs the environment by what three's own indirect light weighs it by: the table lookup, the specular colour and its F90 (${maskCall} beside ${lightCall})`);
  ok(tableFirst, "and the light loop has looked the table up (material.dfg) before the mask's output reads it, in three's loop and in the cascades'");
}

console.log(`\n${passed} checks passed`);
