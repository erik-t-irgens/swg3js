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
//  6b. what the held cascades on WebGPU lean on (`src/core/gpu/heldCsm.ts`, pass 1, wave 3): every method of three's
//     `CSMShadowNode`, its cascades' shadow nodes, the node frame and the light shadow it overrides or calls, each held to
//     a hash of its text at the development commit, and what each is relied on for said in its own words;
//  6d. the methods of three's the edge smoothing's jitter works out by hand (`src/core/gpu/taa/taaJitter.ts`, pass 1, wave 7):
//     the camera's view record, its projection and the perspective matrix, each held to a hash of its text;
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
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import * as THREE from 'three';
import { declaredNames, glslCallables, glslCalls, glslVariant, miscalls, resolveIncludes, undeclaredNames, type GlslCallables } from './glslScan.ts';
import { CSM_CHUNK, CUBE_UV_CHUNK, CUBE_UV_MAPPING, THREE_HOLDS, THREE_HOLD_REPORT, holdAt, planThreeHolds, threeChunkAsShipped, threeChunkNow } from '../../../src/core/threeHolds.ts';
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
  // Pass 1, wave 2: three is its development commit 577fb27 (REVISION 188dev; the lockfile holds the commit's tarball by its
  // integrity, `gpuPatches.test.ts`), the stand-in for 0.188.0 until that is released.
  ok(THREE.REVISION === '188dev' && read('package-lock.json').includes('"resolved": "https://codeload.github.com/mrdoob/three.js/tar.gz/577fb270cb4ac153c689856aa6e096342561fb38"'), `three is its development commit 577fb27 (REVISION ${THREE.REVISION}): every anchor below is that text's`);
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
  ok(plan.missing.length === 0 && Object.keys(plan.chunks).every((name) => plan.chunks[name] === threeChunkNow(name)), "laid over three's chunks (and the cascades' own) as shipped, the holds give exactly the chunks three now holds");
  for (const h of THREE_HOLDS) ok(threeChunkNow(h.chunk)!.includes(h.put), `hold "${h.id}": what it puts is in the held ${h.chunk}`);
  // Pass 1, wave 2: the development commit's indirect light is put back to 0.187's, in three's light loop and the cascades'.
  for (const name of ['lights_fragment_begin', `${CSM_CHUNK}lights_fragment_begin`]) {
    const t = threeChunkNow(name)!;
    ok(t.includes('vec3 radiance = vec3( 0.0 );') && !t.includes('vec3 radiance = getIndirectLightRadiance(') && t.includes('vec3 iblIrradiance = vec3( 0.0 );'), `${name}: no ambient or hemisphere light is reflected, and the environment's fill is kept apart (0.187's indirect light)`);
  }
  ok(chunks.lights_fragment_maps.includes('iblIrradiance += getIBLIrradiance( geometryNormal );') && chunks.lights_fragment_end.includes('RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance,') && /void RE_IndirectSpecular_Physical\( const in vec3 radiance, const in vec3 irradiance,[\s\S]*?reflectedLight\.indirectDiffuse \+= indirectDiffuse;\s*\}/.test(chunks.lights_physical_pars_fragment), "the environment's fill is lit inside the indirect highlight, cut by the dielectric highlight's share, as 0.187 lit it");
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

  // The GPU port's pass 1, wave 1: what the pipeline ledger, the key census and the card's clock reach under three's WebGPU
  // renderer (`src/core/gpu/pipeLedger.ts`, `keyCensus.ts`, `gpuTimer.ts`, `framePerf.ts`).
  const pipelines = three('src/renderers/common/Pipelines.js');
  ok(/pipeline = new RenderObjectPipeline\( cacheKey, stageVertex, stageFragment \);\s*this\.caches\.set\( cacheKey, pipeline \);\s*renderObject\.pipeline = pipeline;[\s\S]{0,400}?this\.backend\.createRenderPipeline\( renderObject, promises \);/.test(pipelines), "a new pipeline is in the cache and on its render object before the backend makes it (the ledger reads its key there)");
  ok(pipelines.includes("return stageVertex.id + ',' + stageFragment.id + ',' + this.backend.getRenderCacheKey( renderObject );"), "a pipeline's key is its two programs' ids and the draw state (the census takes it apart so)");
  const gpuBackend = three('src/renderers/webgpu/WebGPUBackend.js');
  const stateAt = gpuBackend.indexOf('getRenderCacheKey( renderObject ) {');
  const stateText = stateAt > 0 ? gpuBackend.slice(stateAt, gpuBackend.indexOf('].join();', stateAt)) : '';
  const stateItems = (stateText.split('return [')[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const wantItems = ['material.transparent', 'material.blending', 'material.premultipliedAlpha', 'material.blendSrc', 'material.blendDst', 'material.blendEquation', 'material.blendSrcAlpha', 'material.blendDstAlpha', 'material.blendEquationAlpha', 'material.colorWrite', 'material.depthWrite', 'material.depthTest', 'material.depthFunc', 'material.stencilWrite', 'material.stencilFunc', 'material.stencilFail', 'material.stencilZFail', 'material.stencilZPass', 'material.stencilFuncMask', 'material.stencilWriteMask', 'material.polygonOffset', 'material.polygonOffsetFactor', 'material.polygonOffsetUnits', 'material.side', 'material.alphaToCoverage', 'frontFaceCW', 'utils.getSampleCountRenderContext( renderContext )', 'utils.getCurrentColorSpace( renderContext )', 'utils.getCurrentColorFormats( renderContext ).join()', 'utils.getCurrentDepthStencilFormat( renderContext )', 'utils.getPrimitiveTopology( object', 'material )', 'utils.getStripIndexFormat( object', 'geometry )', 'this.attributeUtils.getVertexBufferLayoutCacheKey( renderObject )', 'renderObject.clippingContextCacheKey'];
  // At three's development commit 577fb27 the colour formats are every output's, joined by commas: the census finds the items
  // after them from the topology (keyCensus.ts `parsePipelineKey`), and holds that a topology is one of WebGPU's five.
  ok(stateItems.join('|') === wantItems.join('|'), `the draw state's items in the order the census groups read them (keyCensus.ts DRAW_STATE_GROUPS): ${stateItems.join(', ')}`);
  const topo = three('src/renderers/webgpu/utils/WebGPUUtils.js');
  ok(/getPrimitiveTopology\( object, material \) \{[\s\S]{0,600}?GPUPrimitiveTopology\.PointList[\s\S]{0,400}?GPUPrimitiveTopology\.LineList[\s\S]{0,400}?GPUPrimitiveTopology\.TriangleList/.test(topo), "the topology item is one of WebGPU's own topology names (the census reads the outputs' end from it)");
  // Pass 1, wave 2: the card's clock is three's `GPUTimer` (three's development commit 577fb27 took out `trackTimestamp`,
  // `resolveTimestampsAsync` and the pool's per-pass map); `gpuTimer.ts` times each pass alone by beginning its one timer just
  // before the pass begins and ending it as soon as the pass has begun.
  // Every clock anchor is read off the build the game loads (`build/three.webgpu.js`), class by class, never off three's src/:
  // at the commit the two differ in what a timer answers (the build's `endTimer` answers a bare number of milliseconds, the
  // src/'s a record `{ start, end, delta }`), and anchors read off the src/ passed while the game's clock answered nothing.
  const webgpuBuild = three('build/three.webgpu.js').replace(/\r\n?/g, '\n');
  /** A class of the build, from its line to its closing brace ('' when the build has no such class). */
  const buildClass = (name: string): string => {
    const at = webgpuBuild.search(new RegExp(`^class ${name}\\b`, 'm'));
    return at < 0 ? '' : webgpuBuild.slice(at, webgpuBuild.indexOf('\n}\n', at) + 2);
  };
  /** One method of a class of the build, from its line to its closing brace ('' when it has none). */
  const buildMethod = (cls: string, name: string): string => {
    const c = buildClass(cls);
    const at = c.search(new RegExp(`^\\t(async )?${name}\\(`, 'm'));
    return at < 0 ? '' : c.slice(at, c.indexOf('\n\t}\n', at) + 3);
  };
  ok(buildMethod('WebGPUBackend', 'beginRender').includes('this.initTimestampQuery( renderContext, descriptor );'), "a render pass is given its timestamp writes inside beginRender (the timer begun round it holds that pass's queries alone)");
  ok(/initTimestampQuery\( renderContext, descriptor \) \{\s*const timestampQueryPool = this\.timestampQueryPool;\s*const baseOffset = timestampQueryPool !== null \? timestampQueryPool\.allocateQueries\(\) : null;\s*if \( baseOffset === null \) \{\s*descriptor\.timestampWrites = undefined;\s*return;/.test(buildMethod('WebGPUBackend', 'initTimestampQuery')), 'with no timer active a pass carries no writes (the clock is free unless asked)');
  ok(/beginTimer\(\) \{\s*if \( this\.hasTimestamp === false \) return null;\s*if \( this\.timestampQueryPool === null \) this\.timestampQueryPool = this\.createTimestampQueryPool\(\);/.test(buildMethod('Backend', 'beginTimer')), 'and no query set is made before the first timer begins');
  ok(/async endTimer\( timer \) \{\s*if \( timer === null \) return null;\s*await this\.timestampQueryPool\.endTimer\( timer \);\s*return this\.timestampQueryPool\.getDuration\( timer \);\s*\}/.test(buildMethod('Backend', 'endTimer')), "a timer answers its pool's duration, a bare number (the build's shape at the commit; its src/ answers { start, end, delta }; gpuTimer.ts reads both, and this says which one runs)");
  ok(/getDuration\( timer \) \{\s*if \( timer\.lost \) return null;\s*return timer\.begin === null \? 0 : Number\( timer\.finish - timer\.begin \) \/ 1e6;\s*\}/.test(buildMethod('WebGPUTimestampQueryPool', 'getDuration')), "and the WebGPU pool's duration is milliseconds from the earliest begin to the latest end of its passes, null when a query was lost");
  ok(buildMethod('Backend', 'updateTimeStampUID').includes("contextData.timestampUID = prefix + ':' + id + ':f' + frame;") && /getTimestampUID\( abstractRenderContext \) \{\s*return this\.get\( abstractRenderContext \)\.timestampUID;/.test(buildMethod('Backend', 'getTimestampUID')), "a pass's uid ends in its frame, read through getTimestampUID");
  const rendererCommon = buildClass('Renderer');
  const uidAt = rendererCommon.indexOf('this.backend.updateTimeStampUID( renderContext );');
  const camAt = rendererCommon.indexOf('renderContext.camera = camera;', uidAt);
  const beginAt = rendererCommon.indexOf('this.backend.beginRender( renderContext );', uidAt);
  ok(uidAt > 0 && camAt > uidAt && beginAt > camAt, "a render's uid and camera are set before its pass begins (the clock names each pass there)");
  ok(/_renderScene\( scene, camera, useFrameBufferTarget = true \) \{/.test(rendererCommon), 'the renderer draws a scene through the method the frame report wraps');
  ok(/this\._requestId = this\._context\.requestAnimationFrame\( update \);\s*this\.renderer\.backend\.resolveTimestamps\(\);/.test(buildMethod('Animation', 'start')), "three's animation loop reads the timers' queries back once a frame");
  ok(/this\._measurement = this\.renderer\.backend\.beginTimer\(\);/.test(buildMethod('GPUTimer', 'begin')) && /const result = this\.renderer\.backend\.endTimer\( this\._measurement \);\s*this\._active = false;\s*this\._measurement = null;\s*return result;/.test(buildMethod('GPUTimer', 'end')), "a GPUTimer measures through the backend's timers and may begin again before its last answer is read (it is free as soon as end() is called)");
  const pool = buildClass('WebGPUTimestampQueryPool');
  ok(/allocateQueries\(\) \{\s*if \( this\.isDisposed \|\| this\.timers\.size === 0 \) return null;/.test(pool) && /this\.queryTimers\.set\( baseOffset, this\._retainTimers\(\) \);/.test(pool), "a pass's queries are kept for the timers active as it begins, and none are allocated with no timer active");
  const pipeUtils = three('src/renderers/webgpu/utils/WebGPUPipelineUtils.js');
  ok(/if \( promises === null \) \{\s*pipelineData\.pipeline = device\.createRenderPipeline\( _renderPipelineDescriptor \);/.test(pipeUtils) && /promises\.push\( p \);\s*\}\s*\}/.test(pipeUtils), "a draw's pipeline is made at once and one asked ahead pushes its promise as it is asked (the ledger's landing)");
  const shadowNode = three('src/nodes/lighting/ShadowNode.js');
  ok(/scene\.overrideMaterial = this\.getShadowMaterial\(\);/.test(shadowNode) && /renderer\.render\( scene, shadow\.camera \);/.test(shadowNode), "a shadow map is drawn through its scene with three's shadow material as the override, through the shadow's camera (the clock names cascades and lamps by them)");
  const nodeManager = three('src/renderers/common/nodes/NodeManager.js');
  ok(/getCustomProgramCacheKey\( material, scene \) \{/.test(nodeManager), "three keeps a material's own program key by its version (the ledger reads that copy)");
  const ro3 = three('src/renderers/common/RenderObject.js');
  ok(ro3.includes("if ( /^(is[A-Z]|_)|^(visible|version|uuid|name|opacity|userData|iridescenceThicknessRange)$/.test( property ) ) continue;") && ro3.includes("const _enumProperties = [ 'side', 'blending', 'combine', 'normalMapType' ];"), "the material's properties three keys, as the ledger reduces them");
  ok(/cacheKey \+= object\.skeleton\.bones\.length \+ ',';/.test(ro3) && /cacheKey \+= 'morph-' \+ name \+ ',';/.test(ro3) && /getDynamicCacheKey\(\) \{/.test(ro3), 'three keys a program on the bone count and each morph attribute, and checks the environment every draw');
}

// ---------------------------------------------------------------- 6b. the held cascades (pass 1, wave 3)

{
  // `src/core/gpu/heldCsm.ts` subclasses three's `CSMShadowNode` with no patch of three's, but it leans on the addon's method
  // order and on how three's shadow nodes decide a draw, so every method of three's it overrides or calls is held to its
  // text at three's development commit 577fb27 (REVISION 188dev), the revision `heldCsmApplies` makes it at. The text is
  // read as `gpuPatches.test.ts` reads it: a method is its class's line from `\t<name>(` to the class's next `\t}`, inside
  // the block from `class <Class> ` at a line's start to the next declaration at a line's start; line endings folded to
  // LF; the build files the game loads for three's own classes, the addon's file as it ships (examples are not built).
  // A hash that moves fails here, naming the method: read heldCsm.ts against it again before recording the new one.
  const HELD_RECORDED: Record<string, string> = {
    // Its fields (`lights`, `_shadowNodes`, `breaks`), made empty; `_init` makes the cascade lights and their shadow nodes.
    'examples/jsm/csm/CSMShadowNode.js CSMShadowNode.constructor': '565fb1d8e945f7e7',
    // Overridden (three's run first, then the wraps): one `LwLight` and one `ShadowNode` a cascade, then the frustums.
    'examples/jsm/csm/CSMShadowNode.js CSMShadowNode._init': '98213b7f383c4478',
    // Called by sun.ts as the splits, the reach or the projection move: the boxes and breaks the guards read.
    'examples/jsm/csm/CSMShadowNode.js CSMShadowNode.updateFrustums': '0101a6e30c92d395',
    'examples/jsm/csm/CSMShadowNode.js CSMShadowNode._updateShadowBounds': '32beb2a89f21826e',
    // The order the subclass leans on: the node before its cascades' shadow nodes, so its updateBefore runs first.
    'examples/jsm/csm/CSMShadowNode.js CSMShadowNode.build': '53af7cb35bf59503',
    'examples/jsm/csm/CSMShadowNode.js CSMShadowNode.setup': '2ef6bea2e53b58ac',
    // Overridden and called (`super.updateBefore`): three's own fit of every cascade light, once a game frame now.
    'examples/jsm/csm/CSMShadowNode.js CSMShadowNode.updateBefore': 'fb619c3fa29fac5f',
    // The band the shader samples each cascade over (the coverage proof's `nodeBand`).
    'examples/jsm/csm/CSMShadowNode.js CSMShadowNode._setupFade': '09455ce195c76d4b',
    // A cascade drawn only while asked, once a camera a frame, its ask cleared as it is drawn (`drawnOne`, `undrawnDirty`).
    'build/three.tsl.js ShadowBaseNode.updateBefore': '669fd4816d14d375',
    'build/three.tsl.js ShadowBaseNode.needsRefresh': '073ca92faa67bea1',
    // Wrapped for good (`_heldWrap`): the draw the hold is told of.
    'build/three.tsl.js ShadowNode.updateShadow': 'b3f7a0d581580332',
    // The sampling matrix written only as a map is drawn, so a held cascade keeps its map's.
    'build/three.tsl.js ShadowNode.renderShadow': '777fd3d56e3ec430',
    'build/three.core.js LightShadow.updateMatrices': '1e8d6ff3a0d29f00',
    // Three's walk of a node's own fields for child nodes, which steps over a field named with a leading `_`.
    'build/three.tsl.js Node._getChildren': 'a978aa82ff5c9261',
    // A render-scoped node's updateBefore once a render (the node is reached once a render that lights with the sun).
    'build/three.webgpu.js NodeFrame.updateBeforeNode': '77ccdb28aa9fd667',
  };
  const heldLines = new Map<string, string[]>();
  const heldMethod = (file: string, cls: string, method: string): string | null => {
    let ls = heldLines.get(file);
    if (!ls) heldLines.set(file, (ls = three(file).replace(/\r\n?/g, '\n').split('\n')));
    const start = ls.findIndex((l) => l.startsWith(`class ${cls} `) || l.startsWith(`class ${cls}{`));
    if (start < 0) return null;
    let end = ls.length;
    for (let i = start + 1; i < ls.length; i++) {
      if (/^(class |export |function |const |let |var )/.test(ls[i])) {
        end = i;
        break;
      }
    }
    const head = new RegExp(`^\\t(async )?${method}\\(`);
    const found: number[] = [];
    for (let i = start; i < end; i++) if (head.test(ls[i])) found.push(i);
    if (found.length !== 1) return null;
    for (let i = found[0] + 1; i < end; i++) if (ls[i] === '\t}') return ls.slice(found[0], i + 1).join('\n');
    return null;
  };
  const print = process.argv.includes('--print-held');
  const moved: string[] = [];
  const texts: Record<string, string> = {};
  for (const k of Object.keys(HELD_RECORDED)) {
    const [file, name] = k.split(' ');
    const [cls, method] = name.split('.');
    const t = heldMethod(file, cls, method);
    const h = t === null ? 'missing' : createHash('sha256').update(t).digest('hex').slice(0, 16);
    texts[name] = t ?? '';
    if (print) console.log(`    '${k}': '${h}',`);
    if (h !== HELD_RECORDED[k]) moved.push(`${k} (${h}, recorded ${HELD_RECORDED[k]})`);
  }
  ok(moved.length === 0 || print, `every method of three's the held cascades override or call is the text heldCsm.ts was read against (${Object.keys(HELD_RECORDED).length} of them${moved.length ? `; moved: ${moved.join('; ')}` : ''})`);
  // What each is relied on for, said in its own words, so a moved hash says what to read again.
  ok(/builder\.addSequentialNode\( this \);\s*return super\.build\( builder \);/.test(texts['CSMShadowNode.build']), "the node registers itself before its cascades' shadow nodes, so its updateBefore runs first in each render");
  ok(/_lightDirection\.subVectors\( light\.target\.position, light\.position \)\.normalize\(\);/.test(texts['CSMShadowNode.updateBefore']) && /lwLight\.position\.copy\( _center \);\s*lwLight\.target\.position\.copy\( _center \);\s*lwLight\.target\.position\.add\( _lightDirection \);\s*lwLight\.updateMatrixWorld\(\);\s*lwLight\.target\.updateMatrixWorld\(\);/.test(texts['CSMShadowNode.updateBefore']), "three's fit orients the cascades by the light's own place and target, and moves every cascade light and target and their matrices (what the adapter hands decide, and what the hold puts back)");
  ok(/this\._shadowNodes\.push\( shadow\( lwLight, lShadow \) \);/.test(texts['CSMShadowNode._init']) && /this\.lights\.push\( lwLight \);/.test(texts['CSMShadowNode._init']), '_init makes one cascade light and one shadow node a cascade (what the wraps go on)');
  ok(/if \( frame\.renderer\._precompilationState !== null \) return false;/.test(texts['ShadowBaseNode.updateBefore']) && /let needsUpdate = shadow\.needsUpdate \|\| shadow\.autoUpdate;/.test(texts['ShadowBaseNode.updateBefore']) && /this\.updateShadow\( frame \);\s*shadow\.needsUpdate = false;/.test(texts['ShadowBaseNode.updateBefore']), 'a cascade is drawn only while its shadow asks, never in a precompile, and its ask is cleared just after its updateShadow');
  ok(/if \( this\._cameraFrameId\.get\( camera \) === frameId \) return false;/.test(texts['ShadowBaseNode.needsRefresh']), 'and drawn once a camera a frame (a cascade asked for again in the same frame is not drawn, and the hold finds it dirty)');
  ok(/shadow\.updateMatrices\( light \);/.test(texts['ShadowNode.renderShadow']) && /this\.renderShadow\( frame \);/.test(texts['ShadowNode.updateShadow']), "the sampling matrix is written as the map is drawn, inside updateShadow");
  ok(/property\.charCodeAt\( 0 \) === 95/.test(texts['Node._getChildren']), "three's walk for child nodes steps over a field whose name begins with `_` (the subclass's own are `_held...`)");
  ok(/\} else if \( updateType === NodeUpdateType\.RENDER \) \{[\s\S]*?if \( nodeUpdateBeforeMap\.renderId !== this\.renderId \) \{/.test(texts['NodeFrame.updateBeforeNode']), 'a render-scoped node is updated once a render');
  ok(/const viewZToOrthographicDepth = \( viewZ, near, far \) => viewZ\.add\( near \)\.div\( near\.sub\( far \) \);/.test(three('build/three.tsl.js')) && /viewZToOrthographicDepth\( positionView\.z, cameraNear, shadowFar \)/.test(three('examples/jsm/csm/CSMShadowNode.js')), "the node's linear depth is counted from the camera's near plane (the band the coverage proof samples, heldCsm.test.ts)");
  // The subclass itself names what it overrides and calls.
  const held = read('src/core/gpu/heldCsm.ts');
  ok(['_init(o: Any): void {', 'updateBefore(frame: Any): boolean | undefined {', 'super.updateBefore(frame)', 'sn.updateShadow = (frame: Any): unknown => {', "export const HELD_CSM_REVISION = '188dev';"].every((s) => held.includes(s)), 'heldCsm.ts overrides _init and updateBefore, calls three\'s own fit, wraps each updateShadow, and names the revision it was read against');
}

// ---------------------------------------------------------------- 6c. the bone pool (pass 1, wave 4)

{
  // `src/core/gpu/patchBones.ts` (the sixth private patch, "bones") wraps three's node manager and node library on the live
  // renderer and gives each node material built for a pooled body a `setupPosition` of its own; every method it wraps or
  // leans on is hashed in `gpuPatches.test.ts`. What each is relied on for, said in its own words, out of the build files the
  // game loads, so a moved hash says what to read again.
  const tsl = three('build/three.tsl.js').replace(/\r\n?/g, '\n');
  const gpu = three('build/three.webgpu.js').replace(/\r\n?/g, '\n');
  const method = (text: string, cls: string, name: string): string => {
    const at = text.search(new RegExp(`^class ${cls}\\b`, 'm'));
    if (at < 0) return '';
    const c = text.slice(at, text.indexOf('\n}\n', at) + 2);
    const m = c.search(new RegExp(`^\\t${name}\\(`, 'm'));
    return m < 0 ? '' : c.slice(m, c.indexOf('\n\t}\n', m) + 3);
  };
  const setup = method(tsl, 'NodeMaterial', 'setupPosition');
  ok(/if \( object\.isSkinnedMesh === true \) \{\s*skinning\( object \);\s*\}/.test(setup) && setup.indexOf('morphReference( object )') < setup.indexOf('skinning( object )') && setup.indexOf('skinning( object )') < setup.indexOf('this.displacementMap'), "three's setupPosition skins a body only where it reads isSkinnedMesh true, after its morph and before its displacement (the pool's runs three's own with the flag down, then skins)");
  ok(/this\.hasAnimation = builder\.object\.isSkinnedMesh === true;/.test(method(tsl, 'NodeMaterialObserver', 'constructor')) && /if \( this\.hasNode \|\| this\.hasAnimation \|\|/.test(method(tsl, 'NodeMaterialObserver', 'needsRefresh')), "three's observer calls a skinned body animated and refreshes it in full at every draw (the rule a pooled graph's observer is told is not its)");
  ok(/const bufferCountSnippet = bufferCount > 0 && type === 'buffer' \? ', ' \+ bufferCount : '';/.test(gpu), "a storage buffer's length is written into no program (the pool's size keys nothing)");
  ok(/if \( material\.isNodeMaterial \) return material;/.test(method(gpu, 'NodeLibrary', 'fromMaterial')) && /let nodeMaterial = renderer\.library\.fromMaterial\( material \);/.test(method(gpu, 'NodeBuilder', 'prebuild')), "every material a node builder builds is handed over by the library, a node material (three's shadow material as the override) as itself");
  const forRender = method(gpu, 'NodeManager', 'getForRender');
  ok(/const cacheKey = this\.getForRenderCacheKey\( renderObject \);\s*nodeBuilderState = nodeBuilderCache\.get\( cacheKey \);/.test(forRender) && /nodeBuilder\.build\(\);/.test(forRender) && forRender.indexOf('getForRenderCacheKey') < forRender.indexOf('nodeBuilder.build();'), "a render object's graph is cached by the key the node manager takes, worked out just before its build (the pool's key and its build go together)");
  ok(/\tgetForRenderCacheKey\( renderObject \) \{\s*return renderObject\.initialCacheKey;\s*\}/.test(method(gpu, 'NodeManager', 'getForRenderCacheKey')), "and that key is the render object's own (`initialCacheKey`, fixed when it is made), the pool's being three's own worked out with the skeleton read as pooled once, at the object's first ask, and kept");
  // Wave 4's fixer: three's delete asks the key again as a graph's last user goes, and three lets a render object go and makes
  // it again exactly when its key has moved (the scene's environment), so a key worked out afresh at the delete named another
  // graph: the pool keeps the one it gave at the build.
  const del = method(gpu, 'NodeManager', 'delete');
  ok(/nodeBuilderState\.usedTimes --;\s*if \( nodeBuilderState\.usedTimes === 0 \) \{\s*this\.nodeBuilderCache\.delete\( this\.getForRenderCacheKey\( object \) \);/.test(del), "three's delete takes a graph out of its cache by the key the node manager names for the render object as its last user goes (the pool's kept key)");
  ok(/if \( renderObject\.initialCacheKey !== renderObject\.getCacheKey\(\) \) \{\s*renderObject\.dispose\(\);/.test(method(gpu, 'RenderObjects', 'get')) && /this\.nodes\.delete\( renderObject \);/.test(gpu), 'and lets a render object go (its graph through that delete) when its key has moved since it was made');
  ok(/const kept = pooledRecord\(ro\);\s*if \(kept !== undefined\) \{\s*BUILDING\.pooled = true;\s*return kept\.key;/.test(read('src/core/gpu/patchBones.ts')) && /markPooledRO\(ro, k\);/.test(read('src/core/gpu/patchBones.ts')), "patchBones.ts hands a pooled render object the key it gave at its first ask, at every later ask");
  const direct = method(gpu, 'Renderer', '_renderObjectDirect');
  ok(/const refreshType = this\._nodes\.needsRefresh\( renderObject \);/.test(direct) && /this\._bindings\.updateForRender\( renderObject \);/.test(direct), "every draw asks the node manager's refresh question, and a full refresh writes the object's own values (the pool's slot among them)");
  const pool = read('src/core/gpu/patchBones.ts');
  ok(['N.getForRenderCacheKey = (ro: Any): Any => {', 'lib.fromMaterial = (m: Any): Any => {', 'N._createNodeBuilderState = (nodeBuilder: Any): Any => {', 'N.needsRefresh = function (this: Any, ro: Any): number {', 'nm.setupPosition = pooledSetupPosition;'].every((s) => pool.includes(s)) && !/NodeMaterial\.prototype\.setupPosition\s*=/.test(pool), "patchBones.ts wraps the node manager and the library on the live renderer and gives a material its own setupPosition, never three's prototype");
}

// ---------------------------------------------------------------- 6d. the jitter's projection (pass 1, wave 7)

{
  // `src/core/gpu/taa/taaJitter.ts` writes the view record three's `setViewOffset` makes, in its fields, and works the nudged
  // camera's projection and inverse out by hand as three's `PerspectiveCamera.updateProjectionMatrix` and
  // `Matrix4.makePerspective` work them (`nudgedProjection`), since three's call boxed the frustum's four sides as arguments
  // (the wave's fixer). Each of the three methods is held to a hash of its text at the development commit, read as 6c reads a
  // method (its class's block in the build file the game loads, line endings folded to LF). A hash that moves fails here,
  // naming the method: read `nudgedProjection` against it again before recording the new one (`gpuTaa.test.ts` holds the
  // result to three's own call to the bit, over both coordinate systems and reversed depth).
  const core = three('build/three.core.js').replace(/\r\n?/g, '\n');
  const method = (cls: string, name: string): string => {
    const at = core.search(new RegExp(`^class ${cls}\\b`, 'm'));
    if (at < 0) return '';
    const c = core.slice(at, core.indexOf('\n}\n', at) + 2);
    const m = c.search(new RegExp(`^\\t${name}\\(`, 'm'));
    return m < 0 ? '' : c.slice(m, c.indexOf('\n\t}\n', m) + 3);
  };
  const JITTER_RECORDED: Record<string, string> = {
    // The fields and order of the record the jitter writes in place.
    'PerspectiveCamera.setViewOffset': 'c29f36b7c2e3b932',
    // The four sides from the field of view, zoom, aspect, the view's offsets and sizes and the film offset.
    'PerspectiveCamera.updateProjectionMatrix': '052870c1648900da',
    // The matrix from the four sides, near and far, by coordinate system and reversed depth.
    'Matrix4.makePerspective': '6aed0b2e7d63828a',
  };
  const print = process.argv.includes('--print-jitter');
  const moved: string[] = [];
  const texts: Record<string, string> = {};
  for (const k of Object.keys(JITTER_RECORDED)) {
    const [cls, name] = k.split('.');
    const t = method(cls, name);
    const h = t === '' ? 'missing' : createHash('sha256').update(t).digest('hex').slice(0, 16);
    texts[k] = t;
    if (print) console.log(`    '${k}': '${h}',`);
    if (h !== JITTER_RECORDED[k]) moved.push(`${k} (${h}, recorded ${JITTER_RECORDED[k]})`);
  }
  ok(moved.length === 0 || print, `every method of three's the jitter's hand-worked projection follows is the text it was read against (${Object.keys(JITTER_RECORDED).length} of them${moved.length ? `; moved: ${moved.join('; ')}` : ''})`);
  ok(/this\.projectionMatrix\.makePerspective\( left, left \+ width, top, top - height, near, this\.far, this\.coordinateSystem, this\.reversedDepth \);\s*this\.projectionMatrixInverse\.copy\( this\.projectionMatrix \)\.invert\(\);/.test(texts['PerspectiveCamera.updateProjectionMatrix']), "three's updateProjectionMatrix hands makePerspective the four sides it works out, then inverts a copy (the two steps nudgedProjection writes out)");
  const jit = read('src/core/gpu/taa/taaJitter.ts');
  ok(jit.includes('nudgedProjection(camera, v);') && !/camera\.updateProjectionMatrix\(\)|camera\.clearViewOffset\(\)|\.setViewOffset\(/.test(jit.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), "taaJitter.ts works the nudge out itself and calls none of three's projection methods in a frame");
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
  // The development commit's lines the r188 pieces find and put (src/core/threeHold188.ts, pass 1's wave 2): the ambient's
  // irradiance and the environment's fill, held apart again, and the ambient's reflection, taken out of the light loop.
  getAmbientLightIrradiance: ['vec3(vec3)'],
  getIBLIrradiance: ['vec3(vec3)'],
  getIndirectLightRadiance: ['vec3(vec3, vec3, float)'],
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
          // Read with `textureLod( ..., 0.0 )` from three's development commit 577fb27 on (the table has one level).
          const table = whole.indexOf('material.dfg = textureLod( dfgLUT');
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
