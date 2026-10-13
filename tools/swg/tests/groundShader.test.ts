// The ground's programs, assembled exactly as the game assembles them, out of the game's own injections.
//
// Three separate injections write into the ground at `#include <common>` -- the ground's own textures, the
// weather's, and the bumps -- and each inserts at the **first** match, so the last one to run lands **first**
// in the file. That is how the bump maps were shipped declaring a `sampler2DArray` above the `precision` line
// that gives it a precision, and calling `groundSlope()` above every uniform and varying it reads. A shader
// that will not compile does not draw a worse ground; it draws none, and the whole terrain went with it.
//
// So this checks what a reading of the code will not, of both programs the ground can be drawn with:
//
//   1. the version-3 program (a pack from before terrain shaders version 4, or `swg.ground.tiles` '0') is the
//      text it always was, to the character, against a copy taken before the tile program came; and every name
//      in it is declared before it is used
//   2. the tile program (materials and ground pass, wave 5): every name declared before it is used, in the
//      string the renderer is really handed with every chunk expanded; no name declared twice in one scope
//      (the blade glow lesson's scanner); the weather's ground -- wet look, puddles, rain rings, snow -- still
//      in it and still having the last word at the normal and roughness stages; the flat shine inside three's
//      own light function after its highlight; the clouds over the lit colour and the self test's view at the
//      very end; one text for every planet (no define that varies by world); and nothing written into a shader
//      that lacks a stage it needs
//
// Run: node tools/swg/tests/groundShader.test.ts

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GROUND_DECLS_END, GROUND_TILES_KEY, TILE_FLAT_LINE, groundTilesMaterial, injectGroundFamilies, injectGroundNormal, injectGroundTiles, makeGroundTileUniforms } from '../../../src/world/terrainTextures.ts';
import { injectWetness } from '../../../src/world/wetness.ts';
import { GGX_ANCHOR } from '../../../src/world/specular.ts';
import { glslVariant, redeclared } from './glslScan.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

type Shader = { fragmentShader: string; vertexShader: string; uniforms: Record<string, unknown>; defines?: Record<string, unknown> };

/** The version-3 ground's own injection as it stood before the tile program came, kept here as the witness. */
function injectGroundBefore(shader: Shader, count: number): void {
  shader.defines = { ...(shader.defines ?? {}), TERRAIN_FAMILIES: count };
  shader.uniforms.uGround = { value: null };
  shader.uniforms.uGroundLayer = { value: new Float32Array(count) };
  shader.uniforms.uGroundSize = { value: new Float32Array(count) };
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec3 aFamily;\nattribute vec3 aBary;\nvarying vec3 vFamily;\nvarying vec3 vBary;\nvarying vec2 vGroundXZ;')
    .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvFamily = aFamily;\nvBary = aBary;\nvGroundXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\nprecision highp sampler2DArray;\nuniform sampler2DArray uGround;\nuniform float uGroundLayer[TERRAIN_FAMILIES];\nuniform float uGroundSize[TERRAIN_FAMILIES];\nvarying vec3 vFamily;\nvarying vec3 vBary;\nvarying vec2 vGroundXZ;\nvec4 groundSample(float family) {\n  int id = clamp(int(family + 0.5), 0, TERRAIN_FAMILIES - 1);\n  return texture(uGround, vec3(vGroundXZ / uGroundSize[id], uGroundLayer[id]));\n}\n${GROUND_DECLS_END}`)
    .replace('#include <map_fragment>', '#include <map_fragment>\n{\n  vec3 w = vBary / max(vBary.x + vBary.y + vBary.z, 1e-4);\n  vec4 g = groundSample(vFamily.x) * w.x + groundSample(vFamily.y) * w.y + groundSample(vFamily.z) * w.z;\n  diffuseColor.rgb *= g.rgb;\n}');
}

const physical = (): Shader => ({ fragmentShader: THREE.ShaderLib.physical.fragmentShader, vertexShader: THREE.ShaderLib.physical.vertexShader, uniforms: {}, defines: {} });

function buildFamilies(withBumps: boolean, inject: (s: Shader, n: number) => void = (s, n) => injectGroundFamilies(s, n, null, new Float32Array(n), new Float32Array(n))): Shader {
  const shader = physical();
  inject(shader, 16);
  injectWetness(shader as never, 'ground');
  if (withBumps) injectGroundNormal(shader as never, new THREE.DataArrayTexture(new Uint8Array(4), 1, 1, 1), { value: 1 });
  return shader;
}

/** Every `#include` expanded, as the renderer expands them, so a name a chunk uses is seen where it is used. */
const resolve = (s: string): string =>
  s.replace(/^[ \t]*#include +<([\w\d./]+)>/gm, (_m, name: string) => {
    const chunk = (THREE.ShaderChunk as unknown as Record<string, string>)[name];
    if (chunk === undefined) throw new Error(`no chunk ${name}`);
    return resolve(chunk);
  });

/** Where a name is first declared (`<type> name` or `<type> name(`), and where it is first used anywhere else. */
function declaredBeforeUse(src: string, name: string): { declared: number; firstUse: number } {
  const decl = new RegExp(`\\b(?:uniform|varying|attribute|flat varying)?\\s*\\b(?:float|int|vec2|vec3|vec4|sampler2D|sampler2DArray)\\s+${name}\\b`).exec(src);
  const declared = decl ? decl.index : -1;
  const use = new RegExp(`\\b${name}\\b`, 'g');
  let firstUse = -1;
  for (let m = use.exec(src); m; m = use.exec(src)) {
    if (decl && m.index >= declared && m.index < declared + decl[0].length) continue;
    firstUse = m.index;
    break;
  }
  return { declared, firstUse };
}

// ---------------------------------------------------------------- 1. the version-3 program, unchanged

{
  const now = buildFamilies(true);
  const before = buildFamilies(true, injectGroundBefore);
  ok(now.fragmentShader === before.fragmentShader && now.vertexShader === before.vertexShader, 'a pack from before draws the very program it always drew: the injection the game runs now writes the text the ground had, to the character');
  ok(JSON.stringify(now.defines) === JSON.stringify(before.defines) && Object.keys(now.uniforms).join() === Object.keys(before.uniforms).join(), 'with the same define (TERRAIN_FAMILIES, the per-world size that keeps it a program per world) and the same uniforms');
  ok(buildFamilies(false).fragmentShader === buildFamilies(false, injectGroundBefore).fragmentShader, 'and without bump maps too');

  const f = now.fragmentShader;
  // The precision line is what gives `sampler2DArray` a precision at all: a uniform of that type
  // declared above it is an error on its own, whatever else is wrong.
  const precision = f.indexOf('precision highp sampler2DArray;');
  ok(precision >= 0, 'the ground declares a precision for its sampler arrays');
  ok(f.indexOf('uniform sampler2DArray uGroundNormal;') > precision, "and the bumps' own sampler is declared below it, not above");

  // Every name the bump block reads, against where it is declared.
  const use = f.indexOf('vec2 groundSlope(float family)');
  ok(use > 0, 'the bump block is in the shader at all');
  for (const [name, decl] of [
    ['uGroundSize', 'uniform float uGroundSize['],
    ['uGroundLayer', 'uniform float uGroundLayer['],
    ['vGroundXZ', 'varying vec2 vGroundXZ;'],
  ] as const) {
    const at = f.indexOf(decl);
    assert.ok(at >= 0 && at < use, `${name} is declared before groundSlope reads it`);
  }
  passed++;
  console.log('ok   and every uniform and varying it reads is declared above it');

  const called = f.indexOf('groundSlope(vFamily.x)');
  ok(called > use, 'the function is defined before the block that calls it');
  for (const [name, decl] of [
    ['vFamily', 'varying vec3 vFamily;'],
    ['vBary', 'varying vec3 vBary;'],
    ['uGroundNormalScale', 'uniform float uGroundNormalScale;'],
  ] as const) {
    const at = f.indexOf(decl);
    assert.ok(at >= 0 && at < called, `${name} is declared before the block that reads it`);
  }
  passed++;
  console.log('ok   as is everything the block itself reads');

  // The gloss rides in the same texture's alpha and is written at the roughness stage, which is a
  // second place the same ordering trap could be sprung.
  const glossUse = f.indexOf('float gloss = groundBump(');
  ok(glossUse > 0, "the client's own gloss mask is read");
  ok(f.indexOf('vec4 groundBump(float family)') < glossUse, 'through a function defined above it');
  ok(f.indexOf('uniform float uGroundGloss;') < glossUse, 'with its own strength declared above it');
  ok(f.indexOf('#include <roughnessmap_fragment>') < glossUse, 'and written where a roughness exists to change');

  // The ground's own relief must be laid down first and the rain rings over it, or a puddle's
  // surface is wiped out by the grain under it.
  const bump = f.indexOf('vec2 gs = (groundSlope(');
  const rings = f.indexOf('vec2 wetRing = rainRingSlope(');
  const anchor = f.indexOf('#include <normal_fragment_maps>');
  ok(anchor >= 0 && bump > anchor, 'the bump block is written at the normal stage, where a normal exists to change');
  ok(rings > bump, "and the rain's rings are written after it, so a puddle's surface is laid over the ground's grain rather than wiped out by it");
  // Wet stone is smoother than dry stone however glossy the dry stone was, so the weather's own
  // roughness must have the last word over the client's gloss mask.
  const wetRough = f.search(/roughnessFactor\s*=\s*mix|roughnessFactor\s*-=|wetRough/);
  ok(wetRough < 0 || wetRough > f.indexOf('float gloss = groundBump('), "and the weather's roughness is written after the gloss");
  ok(buildFamilies(false).fragmentShader.indexOf('groundSlope') < 0, 'a pack with no bump maps gets a shader with no trace of them, which is the ground exactly as it was');

  const shader = { fragmentShader: 'void main() {}', uniforms: {} as Record<string, { value: unknown }> };
  const wrote = injectGroundNormal(shader, null, { value: 1 });
  ok(!wrote && shader.fragmentShader === 'void main() {}', 'a shader with nowhere to put the bumps is left exactly as it was, rather than handed something that will not compile');
}

// ---------------------------------------------------------------- 2. the tile program

{
  const u = makeGroundTileUniforms();
  const shader = physical();
  const went = injectGroundTiles(shader, u);
  ok(went, 'the tile program goes into three\'s own physical shader: every stage it writes at is there, and three\'s highlight line its flat shine follows');
  const fs = shader.fragmentShader;
  const vs = shader.vertexShader;
  const frag = resolve(fs);
  const vert = resolve(vs);

  // Declared before used, in the text with every chunk expanded.
  const fragNames = ['uGround', 'uGroundBump', 'uGroundMask', 'uGroundClouds', 'uGroundFrame', 'uGroundLook', 'uGroundShine', 'uGroundCloud', 'vGroundLayers', 'vGroundBlend', 'vGroundTile', 'vGroundUV', 'vGroundTint', 'gGroundW', 'gGroundBump', 'gGroundAlbedo', 'gGroundFlat', 'gGroundNormalW', 'groundTurn', 'groundTurnDir', 'groundMaskTap', 'groundMask', 'groundDecode', 'groundEncode', 'groundCloudShade'];
  const lateFrag = fragNames.filter((n) => {
    const d = declaredBeforeUse(frag, n);
    return d.declared < 0 || (d.firstUse >= 0 && d.firstUse < d.declared);
  });
  ok(lateFrag.length === 0, `every name the tile fragment reads is declared before its first use, its uniforms, varyings, globals and functions${lateFrag.length ? `: ${lateFrag.join(', ')}` : ''}`);
  const vertNames = ['aGroundLayers', 'aGroundBlend', 'aGroundTint', 'uGroundFrame', 'uGroundTint', 'uGroundTintRef', 'vGroundLayers', 'vGroundBlend', 'vGroundTile', 'vGroundUV', 'vGroundTint', 'groundTintOf'];
  const lateVert = vertNames.filter((n) => {
    const d = declaredBeforeUse(vert, n);
    return d.declared < 0 || (d.firstUse >= 0 && d.firstUse < d.declared);
  });
  ok(lateVert.length === 0, `and so is every one the tile vertex stage reads${lateVert.length ? `: ${lateVert.join(', ')}` : ''}`);
  ok(frag.indexOf('precision highp sampler2DArray;') < frag.indexOf('uniform sampler2DArray uGround;'), 'the sampler arrays are given their precision before any of them is declared');
  // The flat varyings a triangle carries whole are declared alike in both stages, or the program does not link.
  for (const v of ['flat varying vec4 vGroundLayers;', 'flat varying vec4 vGroundBlend;', 'varying vec2 vGroundTile;', 'varying vec2 vGroundUV;', 'varying vec3 vGroundTint;']) assert.ok(vs.includes(v) && fs.includes(v), `${v} in both stages`);
  passed++;
  console.log('ok   and every varying is declared alike in both stages, the flat ones flat in both, or the program would not link');
  ok(vs.includes('uniform vec4 uGroundFrame;') && fs.includes('uniform vec4 uGroundFrame;'), 'the frame both stages read is the same uniform declared the same way in each');

  // No name declared twice in one scope: what a compiler refuses and no text check sees. The scanner is checked first.
  ok(redeclared('vec3 groundCloudShade( const in vec3 lit ) { float k = 1.0; float k = 2.0; return lit; }').includes('groundCloudShade: k'), 'the scope scan finds a name planted twice in a function of the tile program\'s shape');
  const base = physical();
  injectWetness(base as never, 'ground');
  const twice: string[] = [];
  for (const defines of [[], ['USE_SHADOWMAP'], ['USE_SHADOWMAP', 'SWG_WET'], ['SWG_WET']]) {
    const d = new Set(defines);
    const seen = new Set([...redeclared(glslVariant(resolve(base.fragmentShader), d)), ...redeclared(glslVariant(resolve(base.vertexShader), d))]);
    for (const t of [...redeclared(glslVariant(frag, d)), ...redeclared(glslVariant(vert, d))]) if (!seen.has(t)) twice.push(`${defines.join('+') || 'plain'}: ${t}`);
  }
  ok(twice.length === 0, `no name the tile program adds is declared twice in one scope, with and without the shadows and the wet look${twice.length ? `: ${twice.slice(0, 6).join(', ')}` : ''}`);

  // The weather's ground is all there, and has the last word.
  ok(fs.includes('#define SWG_WET') && fs.includes('rainRingSlope(') && fs.includes('wetPuddle =') && fs.includes('wetSnow ='), 'the wet look, the puddles, the rain rings and the settled snow are all in the tile program');
  const tileNormal = fs.indexOf('vec3 gn = gGroundBump.xyz * 2.0 - 1.0;');
  const rings = fs.indexOf('vec2 wetRing = rainRingSlope(');
  ok(tileNormal > fs.indexOf('#include <normal_fragment_maps>') && rings > tileNormal, "the tiles' bumps are laid down at the normal stage and the rain's rings after them, so a puddle lies over the ground's grain");
  const lean = fs.indexOf('gGroundNormalW = normalize(');
  ok(lean > tileNormal && lean < rings && fs.indexOf('vec4( gGroundNormalW * 0.5 + 0.5, gGroundBump.a )') > fs.indexOf('#include <dithering_fragment>'), "the lean the self test reads is the tiles' own, kept before the rain's rings touch the normal, and shown last with the gloss");
  const tileRough = fs.indexOf('roughnessFactor = clamp( roughnessFactor - gGroundBump.a * uGroundShine.x');
  const wetRough = fs.indexOf('roughnessFactor = mix(roughnessFactor, 0.04, wetPuddle);');
  ok(tileRough > fs.indexOf('#include <roughnessmap_fragment>') && wetRough > tileRough, "the gloss is written at the roughness stage and the weather's own after it: wet stone is smoother than dry stone however glossy");
  ok(fs.indexOf('gGroundAlbedo = gColour.rgb * groundDecode( vGroundTint );') > fs.indexOf('#include <map_fragment>') && fs.indexOf('gGroundAlbedo = gColour.rgb') < fs.indexOf('float wetSurface = 0.0;'), "the tiles' colour and tint are laid down at the colour stage, before the wet look darkens it");

  // The flat shine inside three's own light function, after its highlight.
  const fn = frag.indexOf('void RE_Direct_Physical(');
  const ggx = frag.indexOf(GGX_ANCHOR, fn);
  const flat = frag.indexOf(TILE_FLAT_LINE, fn);
  ok(fn > 0 && ggx > fn && flat > ggx && flat < frag.indexOf('}', flat), "the flat shine is added in RE_Direct_Physical straight after three's own highlight, for every direct light");
  ok(frag.indexOf('float gGroundFlat = 0.0;') < fn, 'and the global it reads is declared above the light functions, which cannot see main()');
  ok(THREE.ShaderChunk.lights_physical_pars_fragment.includes(GGX_ANCHOR), "three 0.185's lighting chunk still has the highlight line the flat shine follows");

  // The clouds over the lit colour, and the view at the very end.
  const clouds = fs.indexOf('if ( uGroundCloud.x > 0.5 ) outgoingLight *= groundCloudShade( outgoingLight );');
  ok(clouds > 0 && clouds < fs.indexOf('#include <opaque_fragment>') && clouds > fs.indexOf('vec3 outgoingLight'), 'the cloud shadows darken the lit ground just before it is written, behind a uniform, so turning them on compiles nothing');
  const view = fs.indexOf('if ( uGroundLook.z > 0.5 ) gl_FragColor');
  ok(view > fs.indexOf('#include <dithering_fragment>'), "the program's own view of its colour is written last, over everything, for the self test");

  // One program for every planet.
  ok(!('TERRAIN_FAMILIES' in (shader.defines ?? {})) && !/uniform float uGroundLayer\[|uGroundSize\[/.test(fs), 'the tile program has no per-world define and no per-family arrays: one text for every planet');
  const other = physical();
  injectGroundTiles(other, makeGroundTileUniforms());
  ok(other.fragmentShader === fs && other.vertexShader === vs, 'and a second world\'s uniforms make the very same text');
  const mat = groundTilesMaterial(makeGroundTileUniforms(), null);
  ok(mat.customProgramCacheKey() === GROUND_TILES_KEY && mat.userData.wetBuiltIn === true, 'its material keys every planet\'s ground alike and carries its own wet look, so the scan never wraps it again');
  mat.dispose();
  for (const k of Object.keys(u)) assert.ok(shader.uniforms[k] === (u as unknown as Record<string, unknown>)[k], `uniform ${k} is the set's own object`);
  passed++;
  console.log('ok   every uniform the program reads is the very object the set holds, so a knob moves it with nothing compiled');
  ok('uWetness' in shader.uniforms && 'uRain' in shader.uniforms, "and the weather's shared uniforms are there beside them");

  // It refuses rather than breaks.
  const bare = { fragmentShader: 'void main() {}', vertexShader: 'void main() {}', uniforms: {} as Record<string, unknown> };
  ok(!injectGroundTiles(bare, makeGroundTileUniforms()) && bare.fragmentShader === 'void main() {}' && bare.vertexShader === 'void main() {}', 'a shader with nowhere to put the tiles is left exactly as it was');
  const noGgx = physical();
  ok(!injectGroundTiles(noGgx, makeGroundTileUniforms(), 'void RE_Direct_Physical() {}') && noGgx.fragmentShader === THREE.ShaderLib.physical.fragmentShader, "and so is one whose lighting has lost the highlight line the flat shine follows");
}

console.log(`\n${passed} checks passed`);
