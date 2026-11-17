// The GPU port's step 6, items 1 to 3, in node: the effects chain's node graphs on WebGPU (`src/core/gpu/gpuChain.ts`), held
// to the WebGL passes they stand in for, since node draws nothing (`__debug.gradeSelfTest()` and the browser's picture pairs
// hold the pixels).
//
//  1. every uniform each graph reads is one of its WebGL pass's own, by name, and read by reference off that pass's own
//     uniform object (a number as it is written, a vector as the very object, a picture through its `{ value }`); and every
//     uniform the WebGL text declares is read;
//  2. every number of each graph is its WebGL text's own: the sanitize's ceiling, the bright pass's luminance as three's
//     `WebGLProgram` writes it, the composite's two numbers, the grade's literals and its luma, each blur's taps and weights;
//  3. the materials: no depth, no lights, no fog, no tone mapping, placed in clip space on the game's own triangle with its v
//     turned over; the blend blended as the WebGL blend material is;
//  4. what each graph binds (rule 4): its textures, each its own binding;
//  5. the draw of the bloom on WebGPU writes the WebGL pass's own uniforms in the order three's `UnrealBloomPass.render` does;
//  6. what is reached under three: the frame-buffer target's mark the programs' views carry back by, and the output's
//     arithmetic three's own output pass applies (its ACES fit and sRGB curve) against WebGL's.
//
// Run: node tools/swg/tests/gpuChain.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { HeldBloomPass, bloomBlurMaterial185 } from '../../../src/core/fx/bloomHold.ts';
import { BLUR_DIRECTIONS, CHAIN_NUMBERS, GPU_FX_TRIANGLE, bloomGraphs, bloomLuminance, gradeGraph, outputGraph, sanitizeGraph, type ChainGraph } from '../../../src/core/gpu/gpuChain.ts';
import { LUMA } from '../../../src/core/fx/gradeMath.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
let checks = 0;
const ok = (cond: unknown, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
  console.log(`ok   ${msg}`);
};
const read = (f: string): string => readFileSync(join(ROOT, f), 'utf8');

/** A template literal's text named `name` in a file (`name: /* glsl *\/ \`...\``, or `const NAME = ...`). */
function glsl(text: string, name: string): string {
  const re = new RegExp(`(?:const\\s+${name}\\s*=|${name}\\s*:)\\s*(?:/\\*\\s*glsl\\s*\\*/)?\\s*\``);
  const m = re.exec(text);
  assert.ok(m, `the GLSL ${name} is found`);
  const from = m.index + m[0].length;
  return text.slice(from, text.indexOf('`', from));
}
/** The block of a const object named `name` (`const NAME = { ... };`). */
function block(text: string, name: string): string {
  const at = text.indexOf(`const ${name} = {`);
  assert.ok(at >= 0, `${name} is found`);
  return text.slice(at, text.indexOf('\n};', at));
}
const declared = (src: string): Set<string> => new Set([...src.matchAll(/^\s*uniform\s+\w+\s+([\w\s,]+?)(?:\[\w+\])?\s*;/gm)].flatMap((m) => m[1].split(',').map((s) => s.trim())));
const literals = (src: string): number[] => [...src.replace(/\/\/[^\n]*/g, '').matchAll(/(?<![\w.])-?\d+\.\d*(?:e-?\d+)?|(?<![\w.])-?\d+e-?\d+|(?<![\w.])\d+\.(?!\d)/g)].map((m) => Number(m[0]));
const numbersOf = (o: unknown): number[] => (typeof o === 'number' ? [o] : Array.isArray(o) ? o.flatMap(numbersOf) : o && typeof o === 'object' ? Object.values(o).flatMap(numbersOf) : []);
const f32 = (v: number): number => Math.fround(v);

/** A node's value after its once-a-render update: a uniform's own, a texture's base's. */
function valueAfterUpdate(n: Any): unknown {
  if (typeof n.update === 'function' && n.updateType !== undefined && n.updateType !== 'none') n.update({ renderer: null, material: null, object: null });
  return n.isTextureNode ? (n.referenceNode ?? n).value : n.value;
}
/** Every uniform and texture of a graph's parts reads the given WebGL uniforms, by reference, and the parts name every one the text declares. */
function holdsUniforms(what: string, g: ChainGraph, u: Record<string, { value: unknown }>, decl: Set<string>, skip: Set<string> = new Set()): void {
  const named = new Set([...Object.keys(g.parts.uniforms).map((k) => k.replace(/\[\d+\]$/, '')), ...Object.keys(g.parts.textures)]);
  for (const name of decl) if (!skip.has(name)) ok(named.has(name), `${what}: the WebGL uniform ${name} is read by the graph`);
  for (const name of named) ok(decl.has(name), `${what}: the graph's ${name} is a uniform the WebGL text declares`);
  for (const [k, node] of Object.entries(g.parts.textures)) {
    const want = new THREE.Texture();
    u[k].value = want;
    ok(valueAfterUpdate(node) === want, `${what}: the picture ${k} is taken off the WebGL uniform's own { value } at the render`);
  }
  for (const [k, node] of Object.entries(g.parts.uniforms)) {
    const idx = /\[(\d+)\]$/.exec(k);
    const base = k.replace(/\[\d+\]$/, '');
    const src = u[base];
    if (idx) {
      const arr = src.value as unknown[];
      const v = valueAfterUpdate(node);
      ok(v === arr[Number(idx[1])], `${what}: ${k} is the WebGL array's own element, read at the render`);
      continue;
    }
    if (typeof src.value === 'number') {
      src.value = 0.4375;
      ok(valueAfterUpdate(node) === 0.4375, `${what}: the number ${k} is read off the WebGL uniform at the render`);
    } else {
      ok(valueAfterUpdate(node) === src.value, `${what}: the ${k} the graph reads is the WebGL uniform's own object`);
    }
  }
}
/** The materials every graph is drawn with. */
function holdsMaterial(what: string, g: ChainGraph): void {
  const m = g.material as Any;
  ok(m.isNodeMaterial === true && m.depthTest === false && m.depthWrite === false && m.lights === false && m.fog === false && m.toneMapped === false, `${what}: an unlit node material with no depth, no fog and no tone mapping of its own`);
  ok(!!m.fragmentNode && !!m.vertexNode, `${what}: its fragment is the graph's and its triangle is placed in clip space whatever the camera`);
  ok(g.mesh.material === m && g.mesh.geometry === GPU_FX_TRIANGLE && g.mesh.frustumCulled === false, `${what}: drawn on the chain's triangle, never culled`);
  ok(Object.keys(g.parts.textures).length === g.textures, `${what}: it binds ${g.textures} picture${g.textures === 1 ? '' : 's'} (rule 4), each a slot of its own`);
  const bases = new Set(Object.values(g.parts.textures).map((t: Any) => t.fallback));
  ok(bases.size === g.textures, `${what}: no two slots share a fallback picture (two nodes holding one texture would be one binding)`);
}

// ---------------------------------------------------------------- the triangle
{
  const passText = read('src/core/fx/pass.ts');
  const pos = /setAttribute\('position', new THREE\.Float32BufferAttribute\(\[([^\]]+)\]/.exec(passText)![1].split(',').map(Number);
  const uv = /setAttribute\('uv', new THREE\.Float32BufferAttribute\(\[([^\]]+)\]/.exec(passText)![1].split(',').map(Number);
  const gp = [...(GPU_FX_TRIANGLE.getAttribute('position').array as Float32Array)];
  const gu = [...(GPU_FX_TRIANGLE.getAttribute('uv').array as Float32Array)];
  ok(gp.length === pos.length && gp.every((v, i) => v === pos[i]), "the chain's triangle stands where the WebGL passes' own does (FX_TRIANGLE)");
  ok(gu.length === uv.length && gu.every((v, i) => (i % 2 === 0 ? v === uv[i] : v === 1 - uv[i])), "its v is turned over: a WebGPU target's first row is the picture's top, WebGL's its bottom");
}

// ---------------------------------------------------------------- 1, 2 and 3: the sanitize
{
  const passes = read('src/core/fx/passes.ts');
  const src = glsl(block(passes, 'SANITIZE'), 'fragmentShader');
  const u = { tScene: { value: null as THREE.Texture | null } };
  const g = sanitizeGraph(u);
  holdsMaterial('sanitize', g);
  holdsUniforms('sanitize', g, u as never, declared(src));
  ok(literals(src).includes(CHAIN_NUMBERS.sanitize.ceiling), `sanitize: the ceiling ${CHAIN_NUMBERS.sanitize.ceiling} is the WebGL text's own`);
  // The bits a value that is not a number or is infinite fills: the f32 exponent field, all ones; never a finite value's.
  const f = new Float32Array(1);
  const bits = new Uint32Array(f.buffer);
  const filled = (v: number): boolean => {
    f[0] = v;
    return (bits[0] & CHAIN_NUMBERS.sanitize.exponent) >>> 0 === CHAIN_NUMBERS.sanitize.exponent;
  };
  ok(CHAIN_NUMBERS.sanitize.exponent === 0xff << 23, 'sanitize: the mask is the f32 exponent field');
  ok([NaN, Infinity, -Infinity].every(filled), "sanitize: NaN and either infinity fill the exponent field (WGSL's isnan and isinf are gone, and may be folded away)");
  ok([0, -0, 1e-40, 1e-30, 1, 255.9, 256, 65504, 3.4e38, -3.4e38].every((v) => !filled(v)), 'sanitize: no finite value fills it, a half float\'s largest and an f32\'s largest included');
}

// ---------------------------------------------------------------- the bloom
{
  const unreal = read('node_modules/three/examples/jsm/postprocessing/UnrealBloomPass.js');
  const high = read('node_modules/three/examples/jsm/shaders/LuminosityHighPassShader.js');
  const copy = read('node_modules/three/examples/jsm/shaders/CopyShader.js');
  const prog = read('node_modules/three/src/renderers/webgl/WebGLProgram.js');
  const held = new HeldBloomPass(new THREE.Vector2(640, 360), 0.35, 0.5, 0.85);
  const g = bloomGraphs(held);
  const all: [string, ChainGraph][] = [['bloom bright', g.bright], ...g.blurs.flatMap((l, i) => [[`bloom blur ${i} x`, l.h], [`bloom blur ${i} y`, l.v]] as [string, ChainGraph][]), ['bloom composite', g.composite], ['bloom blend', g.blend]];
  for (const [what, gg] of all) holdsMaterial(what, gg);
  // The bright pass.
  const highFrag = glsl(high, 'fragmentShader');
  holdsUniforms('bloom bright', g.bright, (held as Any).highPassUniforms, declared(highFrag));
  ok(/ColorManagement\.getLuminanceCoefficients\( _v0 \);\s*const r = _v0\.x\.toFixed\( 4 \);/.test(prog) && /return dot\( weights, rgb \);/.test(prog), "bloom bright: three's WebGL luminance() is the working space's coefficients to four places, a dot");
  const lum = bloomLuminance();
  ok(lum[0] === 0.2126 && lum[1] === 0.7152 && lum[2] === 0.0722 && g.bright.parts.luminance!.every((v, i) => v === lum[i]), `bloom bright: the graph's luminance is that function's (${lum.join(', ')})`);
  // Each level's two blurs: the WebGL material's own taps and weights.
  const sizes = /const kernelSizeArray = \[ ([\d, ]+) \];/.exec(unreal)![1].split(',').map(Number);
  ok(sizes.join() === '6,10,14,18,22' && held.separableBlurMaterials.length === sizes.length, "bloom: three's pass makes five levels with kernels 6, 10, 14, 18 and 22");
  for (let i = 0; i < sizes.length; i++) {
    const mat = held.separableBlurMaterials[i];
    const want = bloomBlurMaterial185(sizes[i]).uniforms.gaussianCoefficients.value as number[];
    const blurDecl = declared(glsl(read('src/core/fx/bloomHold.ts'), 'fragmentShader'));
    for (const [dir, gg] of [['x', g.blurs[i].h], ['y', g.blurs[i].v]] as const) {
      const what = `bloom blur ${i} ${dir}`;
      ok(gg.parts.taps === 2 * sizes[i] - 1, `${what}: ${2 * sizes[i] - 1} taps, the centre and ${sizes[i] - 1} a side, one fetch a tap (0.185's blur)`);
      ok(gg.parts.weights!.length === sizes[i] && gg.parts.weights!.every((w, k) => w === want[k] && w === (mat.uniforms.gaussianCoefficients.value as number[])[k]), `${what}: its weights are the WebGL material's own Gaussian of a third its radius`);
      holdsUniforms(what, gg, mat.uniforms as never, blurDecl, new Set(['gaussianCoefficients']));
    }
    // The texel is a new vector at every resize: the graph follows it rather than holding the first.
    held.setSize(1280 + i * 2, 720 + i * 2);
    ok(valueAfterUpdate(g.blurs[i].h.parts.uniforms.invSize) === mat.uniforms.invSize.value && valueAfterUpdate(g.blurs[i].v.parts.uniforms.invSize) === mat.uniforms.invSize.value, `bloom blur ${i}: its texel is the WebGL material's own after a resize`);
    mat.uniforms.direction.value = BLUR_DIRECTIONS.y;
    ok(valueAfterUpdate(g.blurs[i].h.parts.uniforms.direction) === BLUR_DIRECTIONS.y, `bloom blur ${i}: its direction is the WebGL material's own, the pass's own two vectors`);
  }
  ok(BLUR_DIRECTIONS.x === (held.constructor as Any).BlurDirectionX && BLUR_DIRECTIONS.y === (held.constructor as Any).BlurDirectionY, "bloom: the two directions are three's pass's own vectors");
  // The composite.
  const compDecl = declared(/_getCompositeMaterial\( nMips \) \{[\s\S]*?fragmentShader: \/\* glsl \*\/`([\s\S]*?)`/.exec(unreal)![1]);
  holdsUniforms('bloom composite', g.composite, held.compositeMaterial.uniforms as never, compDecl);
  for (let i = 0; i < 5; i++) {
    held.compositeMaterial.uniforms[`blurTexture${i + 1}`].value = held.renderTargetsVertical[i].texture;
    ok(valueAfterUpdate(g.composite.parts.textures[`blurTexture${i + 1}`]) === held.renderTargetsVertical[i].texture, `bloom composite: level ${i + 1} is the pass's own vertical target`);
  }
  ok(/vec3 bloom = 3\.0 \* bloomStrength \* \(/.test(unreal) && CHAIN_NUMBERS.bloom.composite === 3.0, "bloom composite: 3.0 times the strength, three's text's own");
  ok(/float mirrorFactor = 1\.2 - factor;/.test(unreal) && CHAIN_NUMBERS.bloom.mirror === 1.2, "bloom composite: the factor's mirror at 1.2, three's text's own");
  ok(/float bloomAlpha = max\( bloom\.r, max\( bloom\.g, bloom\.b \) \);/.test(unreal), 'bloom composite: its alpha is the largest channel, as the graph writes it');
  // The blend.
  holdsUniforms('bloom blend', g.blend, (held as Any).copyUniforms, declared(glsl(copy, 'fragmentShader')));
  const b = held.blendMaterial;
  const m = g.blend.material;
  ok(m.blending === b.blending && b.blending === THREE.AdditiveBlending && m.premultipliedAlpha === b.premultipliedAlpha && b.premultipliedAlpha === true && m.transparent === true, 'bloom blend: added over the picture, premultiplied, as the WebGL blend material is');
  const nodeMaterial = read('node_modules/three/src/materials/nodes/NodeMaterial.js');
  ok(/if \( this\.premultipliedAlpha === true \) \{\s*outputNode = this\.setupPremultipliedAlpha\( builder, outputNode \);/.test(nodeMaterial) && /setupPremultipliedAlpha\( builder, outputNode \) \{\s*return premultiplyAlpha\( outputNode \);/.test(nodeMaterial), "three's node material multiplies its output by its alpha when premultiplied (WebGL's flag only picks the factors)");
  const sentinel = {};
  ok((m as Any).setupPremultipliedAlpha(null, sentinel) === sentinel, "bloom blend: the multiply is left out (the composite's alpha is its largest channel, so it would square every bloom over one), the factors kept");
  const pipe = read('node_modules/three/src/renderers/webgpu/utils/WebGPUPipelineUtils.js');
  ok(/case AdditiveBlending:\s*setBlend\( GPUBlendFactor\.One, GPUBlendFactor\.One, GPUBlendFactor\.One, GPUBlendFactor\.One \);/.test(pipe), "three's WebGPU pipeline adds a premultiplied additive draw at One, One both ways, WebGL's factors");
  for (const gg of [g.bright, ...g.blurs.flatMap((l) => [l.h, l.v]), g.composite]) ok(gg.material.blending === THREE.NormalBlending && gg.material.transparent === false, `${gg.material.name}: drawn opaque, as the WebGL pass draws it`);
  // 5. the draw writes the WebGL pass's own uniforms, in three's order (a number only when it moved: step 6's allocation check).
  const passes = read('src/core/gpu/gpuChainPasses.ts');
  const render = passes.slice(passes.indexOf('render(ctx: FxFrameContext, input: THREE.WebGLRenderTarget, _output: THREE.WebGLRenderTarget | null): boolean {'), passes.indexOf('materials(): FxWarmItem[] {', passes.indexOf('class GpuBloomPass')));
  const three = unreal.slice(unreal.indexOf('render( renderer, writeBuffer, readBuffer, deltaTime, maskActive ) {'), unreal.indexOf('_getSeparableBlurMaterial( kernelRadius ) {'));
  const order = ["highPassUniforms[ 'tDiffuse' ]", "highPassUniforms[ 'luminosityThreshold' ]", "uniforms[ 'colorTexture' ].value = inputRenderTarget", "uniforms[ 'direction' ].value = UnrealBloomPass.BlurDirectionX", "uniforms[ 'colorTexture' ].value = this.renderTargetsHorizontal", "uniforms[ 'direction' ].value = UnrealBloomPass.BlurDirectionY", "uniforms[ 'bloomStrength' ]", "uniforms[ 'bloomRadius' ]", "uniforms[ 'bloomTintColors' ]", "copyUniforms[ 'tDiffuse' ]"];
  const ours = ['highPassUniforms.tDiffuse.value = input.texture', 'const hp = b.highPassUniforms.luminosityThreshold;', 'hp.value = b.threshold', 'uniforms.colorTexture.value = from.texture', 'uniforms.direction.value = BLUR_DIRECTIONS.x', 'uniforms.colorTexture.value = b.renderTargetsHorizontal[i].texture', 'uniforms.direction.value = BLUR_DIRECTIONS.y', 'cu.bloomStrength.value = b.strength', 'cu.bloomRadius.value = b.radius', 'cu.bloomTintColors.value = b.bloomTintColors', 'copyUniforms.tDiffuse.value = b.renderTargetsHorizontal[0].texture'];
  const inOrder = (text: string, list: string[]): boolean => list.every((s, i) => text.indexOf(s) >= 0 && (i === 0 || text.indexOf(s) > text.indexOf(list[i - 1])));
  ok(inOrder(three, order), "bloom: three's UnrealBloomPass.render writes its uniforms in the order the port mirrors");
  ok(inOrder(render, ours), "bloom: the WebGPU draw writes the WebGL pass's own uniforms in that order, each draw on its graph");
}

// ---------------------------------------------------------------- the colour grade
{
  const gradeText = read('src/core/fx/grade.ts');
  const src = glsl(block(gradeText, 'COLOR_GRADE'), 'fragmentShader');
  const u = {
    tDiffuse: { value: null as THREE.Texture | null },
    uAmount: { value: 1 },
    uBalance: { value: new THREE.Vector3(1, 1, 1) },
    uShadowTint: { value: new THREE.Vector3(1, 1, 1) },
    uHighlightTint: { value: new THREE.Vector3(1, 1, 1) },
    uSplit: { value: 0 },
    uSaturation: { value: 1 },
    uContrast: { value: 1 },
    uPivot: { value: 0.18 },
    uCompare: { value: -1 },
  };
  const g = gradeGraph(u);
  holdsMaterial('colour grade', g);
  holdsUniforms('colour grade', g, u as never, declared(src));
  const lumaText = /const vec3 LUMA = vec3\(([^)]+)\);/.exec(src)![1].split(',').map(Number);
  ok(lumaText.every((v, i) => v === LUMA[i] && v === CHAIN_NUMBERS.grade.luma[i]), "colour grade: the luma weights are the WebGL text's own and the mirror's (gradeMath.ts's LUMA)");
  const ours = new Set(numbersOf(CHAIN_NUMBERS.grade).map(f32));
  const theirs = literals(src).filter((v) => v !== 0 && v !== 1);
  for (const v of theirs) ok(ours.has(f32(v)), `colour grade: the WebGL literal ${v} is one of the graph's numbers`);
  for (const v of numbersOf(CHAIN_NUMBERS.grade)) ok(literals(src).some((t) => f32(t) === f32(v)), `colour grade: the graph's number ${v} is a literal of the WebGL text`);
}

// ---------------------------------------------------------------- the output's copy
{
  const out = read('node_modules/three/examples/jsm/shaders/OutputShader.js');
  const u = { tDiffuse: { value: null as THREE.Texture | null } };
  const g = outputGraph(u);
  holdsMaterial('output', g);
  holdsUniforms('output', g, u as never, declared(glsl(out, 'fragmentShader')), new Set(['toneMappingExposure']));
}

// ---------------------------------------------------------------- the warm-up's depth (`patchWarm.ts`'s WARM_DEPTH)
{
  const renderer = read('node_modules/three/src/renderers/common/Renderer.js');
  const ca = renderer.slice(renderer.indexOf('async compileAsync( scene, camera, targetScene = null'), renderer.indexOf('async renderAsync('));
  ok(/renderContext\.depth = this\.depth;\s*renderContext\.stencil = this\.stencil;/.test(ca), "three's compileAsync gives its render context the renderer's depth and stencil, not the target's");
  ok(/renderContext\.depth = renderTarget\.depthBuffer;\s*renderContext\.stencil = renderTarget\.stencilBuffer;/.test(renderer), "a draw into a target gives it the target's");
  const utils = read('node_modules/three/src/renderers/webgpu/utils/WebGPUUtils.js');
  ok(/getCurrentDepthStencilFormat\( renderContext \) \{\s*let format;\s*if \( renderContext\.depth \) \{/.test(utils), "a WebGPU pipeline keys its depth-stencil attachment on the context's depth flag");
  const { withTargetDepth, WARM_DEPTH } = await import('../../../src/core/gpu/warmDepth.ts');
  ok(WARM_DEPTH.on === true, 'the warm-up walks with the target\'s depth and stencil from the start');
  const fake: Any = { depth: true, stencil: true, rt: null as Any, getRenderTarget() { return this.rt; } };
  const seen: [boolean, boolean][] = [];
  fake.rt = { depthBuffer: false, stencilBuffer: false };
  withTargetDepth(fake, () => seen.push([fake.depth, fake.stencil]));
  fake.rt = { depthBuffer: true, stencilBuffer: false };
  withTargetDepth(fake, () => seen.push([fake.depth, fake.stencil]));
  fake.rt = null;
  withTargetDepth(fake, () => seen.push([fake.depth, fake.stencil]));
  ok(seen[0][0] === false && seen[0][1] === false && seen[1][0] === true && seen[1][1] === false, "a walk into a target is made with that target's depth and stencil");
  ok(seen[2][0] === true && seen[2][1] === true && fake.depth === true && fake.stencil === true, "a walk into the canvas keeps the renderer's own, and the renderer's are put back after every walk");
  fake.rt = { depthBuffer: false, stencilBuffer: false };
  try {
    withTargetDepth(fake, () => {
      throw new Error('walk');
    });
  } catch {
    /* thrown on purpose */
  }
  ok(fake.depth === true && fake.stencil === true, 'and put back when the walk throws');
  WARM_DEPTH.on = false;
  withTargetDepth(fake, () => seen.push([fake.depth, fake.stencil]));
  WARM_DEPTH.on = true;
  ok(seen[3][0] === true && seen[3][1] === true, "off, a walk is three's own");
  const warm = read('src/core/gpu/patchWarm.ts');
  ok(read('src/core/gpu/warmDepth.ts').split('\n').filter((l) => /^import /.test(l)).length === 0, 'warmDepth.ts imports nothing (a node test loads it alone)');
  ok((warm.match(/withTargetDepth\(r, \(\) => nativeCompileAsync\(/g) ?? []).length === 2 && !/[^>] nativeCompileAsync\(/.test(warm.replace(/withTargetDepth\(r, \(\) => nativeCompileAsync\(/g, '')), "patchWarm.ts: both of the warm-up's walks (its listing and three's own) go through it");
  const passes = read('src/core/gpu/gpuChainPasses.ts');
  ok(/for \(const t of \[b\.renderTargetBright, \.\.\.b\.renderTargetsHorizontal, \.\.\.b\.renderTargetsVertical\] as THREE\.RenderTarget\[\]\) \{\s*t\.depthBuffer = false;\s*t\.stencilBuffer = false;/.test(passes), "the WebGPU bloom's levels are made with no depth, as the buffer the warm-up compiles them against is");
  const postfx = read('src/core/postfx.ts');
  ok(/this\.bufferA = new THREE\.WebGLRenderTarget\(w, h, \{ type: THREE\.HalfFloatType, depthBuffer: false, stencilBuffer: false, samples: 0 \}\);/.test(postfx) && /if \(it\.where !== 'screen'\) compileOn\(this\.bufferA, object\);/.test(postfx), 'the chain warms every pass that draws into a target against bufferA, which has no depth and no stencil');
}

// ---------------------------------------------------------------- 6. what the chain reaches under three
{
  const renderer = read('node_modules/three/src/renderers/common/Renderer.js');
  ok(/_getFrameBufferTarget\(\) \{[\s\S]*?frameBufferTarget\.isPostProcessingRenderTarget = true;/.test(renderer), "three marks its frame-buffer target (isPostProcessingRenderTarget), which the programs' views carry back by");
  ok(/if \( frameBufferTarget !== null \) \{\s*this\.setRenderTarget\( outputRenderTarget, activeCubeFace, activeMipmapLevel \);\s*this\._renderOutput\( renderTarget \);/.test(renderer), "a render into the canvas through the frame-buffer target ends in three's own output pass");
  ok(/get currentToneMapping\(\) \{\s*return this\.isOutputTarget \? this\.toneMapping : NoToneMapping;/.test(renderer), 'three tone-maps only what is drawn for the screen: a target of the game\'s own is drawn linear, as WebGL draws its chain');
  const ground = read('src/core/gpu/gpuGround.ts');
  ok(ground.includes("f.renderer?.getRenderTarget?.()?.isPostProcessingRenderTarget === true"), "gpuGround.ts: a program's view is carried back only into three's frame-buffer target, never into the chain's scene target");
  // The output's arithmetic: three's TSL ACES fit and sRGB curve against WebGL's (`tonemapping_pars_fragment`, `colorspace_pars_fragment`).
  const tsl = read('node_modules/three/src/nodes/display/ToneMappingFunctions.js');
  const chunk = read('node_modules/three/src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js');
  // Magnitudes: three's TSL writes a negative number with a space after its minus, and the matrices are written transposed.
  const fn = (text: string, from: string, to: string): number[] => literals(text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)))).map(Math.abs);
  const tslAces = [...fn(tsl, 'const RRTAndODTFit', '}, {'), ...fn(tsl, 'export const acesFilmicToneMapping', '}, {')].sort((a, b) => a - b);
  const glAces = [...fn(chunk, 'vec3 RRTAndODTFit', '\n}'), ...fn(chunk, 'vec3 ACESFilmicToneMapping', '\n}')].sort((a, b) => a - b);
  ok(tslAces.length === glAces.length && tslAces.every((v, i) => v === glAces[i]), `three's output pass fits ACES with WebGL's own ${glAces.length} numbers (the matrices, the fit, the 0.6)`);
  ok(/color = color\.mul\( exposure \)\.div\( 0\.6 \);/.test(tsl) && /color \*= toneMappingExposure \/ 0\.6;/.test(chunk), 'both fits take the exposure the same way, before the input matrix');
  const cs = read('node_modules/three/src/nodes/display/ColorSpaceFunctions.js');
  const glcs = read('node_modules/three/src/renderers/shaders/ShaderChunk/colorspace_pars_fragment.glsl.js');
  const tslOetf = fn(cs, 'export const sRGBTransferOETF', '}, {').sort((a, b) => a - b);
  const glOetf = fn(glcs, 'vec4 sRGBTransferOETF', '\n}').sort((a, b) => a - b);
  ok(tslOetf.length > 0 && tslOetf.every((v, i) => v === glOetf[i]), `three's output pass encodes sRGB with WebGL's own numbers (${glOetf.join(', ')})`);
}

console.log(`gpuChain: ${checks} checks passed`);
