// The GPU port's step 6, items 4 and 5, in node: the ambient occlusion's node graphs on WebGPU (`src/core/gpu/gpuSsao.ts`)
// held to the WebGL pass they stand in for, and the inline output (`src/core/gpu/inlineOutput.ts`) held to three's text it
// replaces, since node draws nothing (the browser's views, picture pairs and the fire's pairs hold the pixels).
//
//  1. every uniform each graph reads is one of its WebGL program's own, by name, read off that pass's own uniform object (a
//     number as it is written, a vector or matrix as the very object, an array's element out of the array as it stands at
//     the render, a picture through its `{ value }`); and every uniform the WebGL text declares is read, but the few the
//     graph has no use for, each named with its reason;
//  2. every number of each graph that is not a uniform is the WebGL text's own literal (`SSAO_GPU_NUMBERS`) or the mirror's;
//  3. the materials: unlit, no depth (the water's coverage alone tests it), no fog; the region read tests the stencil as
//     the WebGL region material does; the region target's two blends add one and one;
//  4. what each graph binds (rule 4), each slot its own fallback, of the kind its real picture is;
//  5. the GTAO takes the rooms' spots and casting points as `ssaoGtaoFrag` writes them for the pool at its most;
//  6. the inline output: three's `NodeMaterial.setupOutput` and `Renderer.needsFrameBufferTarget` as 0.187 wrote them
//     (recorded hashes of their text), the switch left out at load touches nothing, and the renderer's own getter answers
//     false only while the switch is on.
//
// Run: node tools/swg/tests/gpuSsao.test.ts   (print the recorded hashes as they stand: add --print)
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';
import type { ChainGraph } from '../../../src/core/gpu/gpuChain.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
// The WebGL pass and its products carry parameter properties, which node's type stripping refuses: `src/` is loaded through
// the repository's own TypeScript (`airLoader.mjs`), three from the checkout as it always is.
register(pathToFileURL(join(ROOT, 'tools', 'swg', 'tests', 'airLoader.mjs')).href, import.meta.url, { data: { roots: [join(ROOT, 'src')], packageBase: join(ROOT, 'package.json') } });
const at = (p: string): string => pathToFileURL(join(ROOT, 'src', p)).href;
const { SSAO_APPLY_FRAG, SSAO_BLUR_FRAG, SSAO_PROBE_FRAG, SsaoPass, ssaoGtaoFrag } = await import(at('core/fx/ssao.ts'));
const { FX_BILATERAL_UPSAMPLE, FX_IGN, FX_LUMA } = await import(at('core/fx/glsl.ts'));
const { FX_MAX_ROOM_CAST, FX_MAX_ROOM_SPOTS } = await import(at('core/fx/lights.ts'));
const { LinearDepthHalf, NormalsHalf } = await import(at('core/fx/products.ts'));
const { DebugViewPass } = await import(at('core/fx/passes.ts'));
const { GPU_FX_TRIANGLE } = await import(at('core/gpu/gpuChain.ts'));
const { SSAO_GPU_NUMBERS, SSAO_GPU_POINTS, applyGraph, blurGraph, debugViewGraph, gtaoGraph, linearDepthHalfGraph, normalsHalfGraph, probeGraph, regionGraph, waterCoverageMaterial } = await import(at('core/gpu/gpuSsao.ts'));
const { INLINE, installInline } = await import(at('core/gpu/inlineOutput.ts'));
const PRINT = process.argv.includes('--print');
let checks = 0;
const ok = (cond: unknown, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
  if (!PRINT) console.log(`ok   ${msg}`);
};

const declared = (src: string): Set<string> => new Set([...src.matchAll(/^\s*uniform\s+(?:highp\s+|lowp\s+|mediump\s+)?\w+\s+([\w\s,]+?)(?:\[\w+\])?\s*;/gm)].flatMap((m) => m[1].split(',').map((s) => s.trim())));
// A literal's sign is the text's operator as often as its own (`x * 2.0404 - 0.3324`): both are kept.
const literals = (src: string): number[] => [...src.replace(/\/\/[^\n]*/g, '').matchAll(/(?<![\w.])-?\d+\.\d*(?:e-?\d+)?|(?<![\w.])-?\d+e-?\d+|(?<![\w.])\d+\.(?!\d)/g)].flatMap((m) => [Number(m[0]), -Number(m[0])]);

/** A node's value after its once-a-render update. */
function valueAfterUpdate(n: Any): unknown {
  if (typeof n.update === 'function' && n.updateType !== undefined && n.updateType !== 'none') n.update({ renderer: null, material: null, object: null });
  if (typeof n.onUpdate === 'function' && n.updateType === 'render' && n._swgTested !== true) {
    // three's onRenderUpdate sets `update`: called above.
  }
  return n.isTextureNode ? (n.referenceNode ?? n).value : n.value;
}

/** The WebGL pass, with a region target of its own (nothing drawn: node has no renderer). */
const host = { hasProduct: () => false, createRegionTarget: () => new THREE.WebGLRenderTarget(1, 1) };
const pass = new SsaoPass(host as never) as Any;
const U = { gU: pass.gU, bU: pass.bU, aU: pass.aU, pU: pass.pU };
const DEPTH = THREE.FloatType;

/**
 * Every name a graph's parts read is declared by `src` (an element `name{i}` and an index `name[i]` by their base) or is one
 * of `extra` (each with its reason), and every name `src` declares is read but `skip`'s.
 */
function holdsNames(what: string, g: ChainGraph, src: string, extra: Record<string, string> = {}, skip: Record<string, string> = {}): void {
  const decl = declared(src);
  const named = new Set([...Object.keys(g.parts.uniforms), ...Object.keys(g.parts.textures)].map((k) => k.replace(/[[{]\d+[\]}]$/, '')));
  for (const name of decl) if (!(name in skip)) ok(named.has(name), `${what}: the WebGL uniform ${name} is read by the graph`);
  for (const name of named) ok(decl.has(name) || name in extra, `${what}: the graph's ${name} is the WebGL text's own${name in extra ? ` (or ${extra[name]})` : ''}`);
}

/** The values are the WebGL uniforms' own: pictures through `{ value }`, numbers as written, vectors the very object, elements out of the array. */
function holdsValues(what: string, g: ChainGraph, u: Record<string, { value: Any }>, own: string[] = []): void {
  for (const [k, node] of Object.entries(g.parts.textures)) {
    if (!(k in u) || own.includes(k)) continue;
    const want = new THREE.Texture();
    const was = u[k].value;
    u[k].value = want;
    ok(valueAfterUpdate(node) === want, `${what}: the picture ${k} is taken off the WebGL uniform's own { value } at the render`);
    u[k].value = was;
  }
  for (const [k, node] of Object.entries(g.parts.uniforms)) {
    const el = /^(\w+)\{(\d+)\}$/.exec(k);
    const ix = /^(\w+)\[(\d+)\]$/.exec(k);
    const base = el ? el[1] : ix ? ix[1] : k;
    const src = u[base];
    if (!src || own.includes(base)) continue;
    if (el) {
      const arr = src.value as Float32Array;
      const i = Number(el[2]);
      const n = (node as Any).value.isVector4 ? 4 : (node as Any).value.isVector3 ? 3 : 2;
      for (let j = 0; j < n; j++) if (i * n + j < arr.length) arr[i * n + j] = 0.125 * (j + 1) + i;
      const v = valueAfterUpdate(node) as Any;
      const got = [v.x, v.y, v.z, v.w].slice(0, n);
      const want = got.map((_, j) => (i * n + j < arr.length ? arr[i * n + j] : 0));
      ok(got.every((x, j) => x === want[j]), `${what}: ${k} is element ${i} of the WebGL array ${base} as it stands at the render`);
      continue;
    }
    if (ix) {
      ok(valueAfterUpdate(node) === (src.value as unknown[])[Number(ix[2])], `${what}: ${k} is the WebGL array's own element`);
      continue;
    }
    if (typeof src.value === 'number') {
      const was = src.value;
      src.value = 0.4375;
      ok(valueAfterUpdate(node) === 0.4375, `${what}: the number ${k} is read off the WebGL uniform at the render`);
      src.value = was;
    } else {
      ok(valueAfterUpdate(node) === src.value, `${what}: the ${k} the graph reads is the WebGL uniform's own object`);
    }
  }
}

/** The material every chain graph is drawn with, and its bindings. */
function holdsMaterial(what: string, g: ChainGraph): void {
  const m = g.material as Any;
  ok(m.isNodeMaterial === true && m.depthTest === false && m.depthWrite === false && m.lights === false && m.fog === false, `${what}: an unlit node material with no depth and no fog`);
  ok(g.mesh.geometry === GPU_FX_TRIANGLE && g.mesh.frustumCulled === false, `${what}: drawn on the chain's triangle, never culled`);
  ok(Object.keys(g.parts.textures).length === g.textures, `${what}: it binds ${g.textures} picture${g.textures === 1 ? '' : 's'} (rule 4)`);
  const bases = Object.values(g.parts.textures).map((t: Any) => t.fallback);
  ok(new Set(bases).size === bases.length, `${what}: no two slots share a fallback picture`);
}

// ---------------------------------------------------------------- 1, 3, 4, 5: the GTAO
{
  const full = ssaoGtaoFrag(FX_MAX_ROOM_SPOTS, FX_MAX_ROOM_CAST);
  ok(full !== ssaoGtaoFrag(0, 0), "the GTAO's text for the pool at its most is not the plain one (its anchors stand)");
  for (const [k, label] of [[0, 'half'], [1, 'full']] as const) {
    // The WebGL pass's own arrays as `setRoomLights` sizes them for the pool at its most.
    pass.setRoomLights(FX_MAX_ROOM_SPOTS, FX_MAX_ROOM_CAST);
    const g = gtaoGraph(U, k === 1, true, DEPTH);
    holdsMaterial(`gtao (${label})`, g);
    holdsNames(`gtao (${label})`, g, full);
    holdsValues(`gtao (${label})`, g, U.gU);
    const t = g.parts.textures as Any;
    ok(t.tDepth.fallback.isDepthTexture === true && t.tDepth.fallback.type === DEPTH && t.tDepth.fallback.format === THREE.DepthStencilFormat, `gtao (${label}): the depth slot's fallback is a depth texture of the scene depth's own kind`);
    for (const s of ['tShadow0', 'tShadow1', 'tShadow2']) ok(t[s].fallback.isDepthTexture === true && t[s].fallback.compareFunction !== null && !!t[s].fallback.renderTarget && t[s].fallback.renderTarget.samples === 0, `gtao (${label}): ${s}'s fallback is a comparison depth texture held by a target of one sample`);
    ok(t.tLinear.fallback.type === THREE.FloatType && t.tLinear.fallback.format === THREE.RedFormat && t.tLinear.fallback.minFilter === THREE.NearestFilter, `gtao (${label}): the half distance's fallback is a 32-bit float red picture, nearest, as the product is`);
    const points = Object.keys(g.parts.uniforms).filter((n) => n.startsWith('uPointPos{')).length;
    ok(points === SSAO_GPU_POINTS, `gtao (${label}): every one of the ${SSAO_GPU_POINTS} points the WebGL arrays hold is read`);
    ok(Object.keys(g.parts.uniforms).filter((n) => n.startsWith('uRoomSpotPos{')).length === FX_MAX_ROOM_SPOTS && Object.keys(g.parts.uniforms).filter((n) => n.startsWith('uRoomCastPos{')).length === FX_MAX_ROOM_CAST, `gtao (${label}): the rooms' spots and casting points at the pool's most`);
  }
  // A text of the GTAO's every number that is not a uniform or the mirror's.
  const lit = literals(full + FX_IGN + FX_LUMA);
  for (const v of [SSAO_GPU_NUMBERS.pi, SSAO_GPU_NUMBERS.halfPi, SSAO_GPU_NUMBERS.golden, SSAO_GPU_NUMBERS.minStepPx, SSAO_GPU_NUMBERS.minRadiusPx, ...SSAO_GPU_NUMBERS.ign, ...SSAO_GPU_NUMBERS.luma]) ok(lit.includes(v), `gtao: ${v} is the WebGL text's own literal`);
  const bayer = /BAYER\[16\] = float\[16\]\(([^)]+)\)/.exec(full);
  ok(!!bayer && bayer[1].split(',').map(Number).every((x, i) => x === SSAO_GPU_NUMBERS.bayer[i]), "gtao: the Bayer table is the WebGL text's own, entry for entry");
}

// ---------------------------------------------------------------- the blur
for (const [k, label] of [[0, 'half'], [1, 'full']] as const) {
  const g = blurGraph(U, k === 1, true, DEPTH);
  holdsMaterial(`blur (${label})`, g);
  // `uAoSize`: the WebGL blur asks the AO texture its size (`textureSize(tAo, 0)`); the graph reads the GTAO's own record of it.
  holdsNames(`blur (${label})`, g, SSAO_BLUR_FRAG);
  holdsValues(`blur (${label})`, g, U.bU);
  const bw = /float BW\[5\] = float\[5\]\(([^)]+)\)/.exec(SSAO_BLUR_FRAG);
  ok(!!bw && bw[1].split(',').map(Number).every((x, i) => x === SSAO_GPU_NUMBERS.blurWeights[i]), `blur (${label}): the Gaussian is the WebGL text's own, weight for weight`);
  ok(literals(SSAO_BLUR_FRAG).includes(SSAO_GPU_NUMBERS.blurFloor), `blur (${label}): the 5 cm floor is the WebGL text's own`);
}

// ---------------------------------------------------------------- the apply
{
  const water = { value: 0 };
  const region = { value: null as THREE.Texture | null };
  for (const [k, label] of [[0, 'half'], [1, 'full']] as const) {
    const g = applyGraph(U, k === 1, true, DEPTH, water, region);
    holdsMaterial(`apply (${label})`, g);
    holdsNames(`apply (${label})`, g, SSAO_APPLY_FRAG + FX_BILATERAL_UPSAMPLE);
    // The water's slot and switch are the WebGPU pass's own records (the stand-ins' coverage), held below.
    holdsValues(`apply (${label})`, g, U.aU, ['tWater', 'uWaterMask']);
    const want = new THREE.Texture();
    region.value = want;
    ok(valueAfterUpdate((g.parts.textures as Any).tWater) === want, `apply (${label}): the water slot reads the region target's picture (its green the stand-ins' coverage on WebGPU, the mask's alpha on WebGL)`);
    water.value = 1;
    ok(valueAfterUpdate((g.parts.uniforms as Any).uWaterMask) === 1, `apply (${label}): whether there is coverage is the WebGPU pass's own record`);
  }
  const lit = literals(SSAO_APPLY_FRAG);
  const b = SSAO_GPU_NUMBERS.bounce;
  for (const v of [...b.a, ...b.b, ...b.c, SSAO_GPU_NUMBERS.albedoMost, SSAO_GPU_NUMBERS.fogFloor, SSAO_GPU_NUMBERS.ceilingFloor]) ok(lit.includes(v), `apply: ${v} is the WebGL text's own literal`);
  ok(/vec4\(1\.0, 0\.0, 0\.5, 1\.0\)/.test(SSAO_APPLY_FRAG) && SSAO_GPU_NUMBERS.fallback.join() === '1,0,0.5,1', "apply: the upsample's fallback is the WebGL text's own");
}

// ---------------------------------------------------------------- the probe, the region, the water's coverage
{
  const g = probeGraph(U, true, DEPTH);
  holdsMaterial('probe', g);
  holdsNames('probe', g, SSAO_PROBE_FRAG);
  holdsValues('probe', g, U.pU);
  const r = regionGraph();
  const m = r.material as Any;
  const wgl = pass.regionMaterial as THREE.Material;
  ok(m.stencilWrite === wgl.stencilWrite && m.stencilFunc === wgl.stencilFunc && m.stencilFuncMask === wgl.stencilFuncMask && m.stencilWriteMask === wgl.stencilWriteMask && m.stencilFail === wgl.stencilFail && m.stencilZFail === wgl.stencilZFail && m.stencilZPass === wgl.stencilZPass, "region: the stencil test is the WebGL region material's own (its reference copied at each draw)");
  ok(m.blending === THREE.CustomBlending && m.blendSrc === THREE.OneFactor && m.blendDst === THREE.OneFactor && m.blendSrcAlpha === THREE.OneFactor && m.blendDstAlpha === THREE.OneFactor, 'region: one and one (the target has no alpha, which WebGPU refuses a blend reading)');
  const w = waterCoverageMaterial() as Any;
  ok(w.depthTest === true && w.depthWrite === false && w.side === THREE.DoubleSide && w.blending === THREE.CustomBlending && w.blendSrc === THREE.OneFactor && w.lights === false, "water: the stand-ins' coverage tests the scene's depth, writes none, both faces, one and one");
}

// ---------------------------------------------------------------- the two products and the debug view
{
  const lin = new LinearDepthHalf() as Any;
  const gl = linearDepthHalfGraph(lin.material.uniforms, true, DEPTH);
  holdsMaterial('linearDepthHalf', gl);
  holdsNames('linearDepthHalf', gl, lin.material.fragmentShader);
  holdsValues('linearDepthHalf', gl, lin.material.uniforms);
  const nor = new NormalsHalf() as Any;
  const gn = normalsHalfGraph(nor.material.uniforms);
  holdsMaterial('normalsHalf', gn);
  holdsNames('normalsHalf', gn, nor.material.fragmentShader);
  holdsValues('normalsHalf', gn, nor.material.uniforms);
  ok(literals(nor.material.fragmentShader).includes(SSAO_GPU_NUMBERS.normalsFar), "normalsHalf: the far plane's 0.999 is the WebGL text's own");
  const dv = new DebugViewPass() as Any;
  const gd = debugViewGraph(dv.material.uniforms, true, DEPTH);
  holdsMaterial('debugView', gd);
  // `tDepth`: the shown picture when it is the scene's depth, a slot of its own (a slot's kind is fixed when its graph is built).
  // `tDiffuse`: the picture coming in, which only the water mask's mode (7, not ported) reads.
  holdsNames('debugView', gd, dv.material.fragmentShader, { tDepth: 'the shown picture as a depth texture' }, { tDiffuse: 'read only by mode 4, which no view of the occlusion or the two products takes' });
  ok((gd.material as Any).swgRawOut === true, "debugView: drawn onto the canvas as WebGL draws it, its numbers as they are (no inline output)");
}

// ---------------------------------------------------------------- 6. the inline output
{
  const BUILD = join(ROOT, 'node_modules', 'three', 'build');
  const lines = (f: string): string[] => readFileSync(join(BUILD, f), 'utf8').replace(/\r\n?/g, '\n').split('\n');
  const method = (file: string, cls: string, head: RegExp): string | null => {
    const l = lines(file);
    const start = l.findIndex((x) => x.startsWith(`class ${cls} `));
    if (start < 0) return null;
    let end = l.length;
    for (let i = start + 1; i < l.length; i++) if (/^(class |export |function |const |let |var )/.test(l[i])) { end = i; break; }
    const found: number[] = [];
    for (let i = start; i < end; i++) if (head.test(l[i])) found.push(i);
    if (found.length !== 1) return null;
    for (let i = found[0] + 1; i < end; i++) if (l[i] === '\t}') return l.slice(found[0], i + 1).join('\n');
    return null;
  };
  const hash = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16);
  const RECORDED: Record<string, string> = {
    'three.tsl.js NodeMaterial.setupOutput': '5062b7bb21ec13c8',
    'three.webgpu.js Renderer.needsFrameBufferTarget': 'cd411a54ed11cadb',
  };
  const texts: Record<string, string | null> = {
    'three.tsl.js NodeMaterial.setupOutput': method('three.tsl.js', 'NodeMaterial', /^\tsetupOutput\( builder, outputNode \) \{/),
    'three.webgpu.js Renderer.needsFrameBufferTarget': method('three.webgpu.js', 'Renderer', /^\tget needsFrameBufferTarget\(\) \{/),
  };
  if (PRINT) for (const [k, t] of Object.entries(texts)) console.log(`  '${k}': '${t ? hash(t) : 'MISSING'}',`);
  for (const [k, t] of Object.entries(texts)) {
    ok(t !== null && hash(t) === RECORDED[k], `${k} is the text the inline output was written against (three 0.187)`);
  }
  // The text the replacement keeps: the fog, then the premultiplied alpha, nothing else.
  const so = texts['three.tsl.js NodeMaterial.setupOutput'] ?? '';
  ok(so.indexOf('this.setupFog( builder, outputNode )') > 0 && so.indexOf('this.setupFog( builder, outputNode )') < so.indexOf('this.setupPremultipliedAlpha( builder, outputNode )'), "three's setupOutput is the fog, then the premultiplied alpha: the inline output goes between them, as WebGL's chunks stand");
  // Left out at load: nothing touched.
  const proto = { get needsFrameBufferTarget(): boolean { return true; } };
  const off = Object.create(proto);
  const mat = Object.getPrototypeOf(waterCoverageMaterial());
  const before = (mat as Any).setupOutput;
  ok(installInline(off, false) !== null && !Object.prototype.hasOwnProperty.call(off, 'needsFrameBufferTarget') && INLINE.applied === false && (mat as Any).setupOutput === before, 'left out at load: neither the renderer nor the node material is touched');
  // Installed: the renderer's own getter, false only while on.
  const on = Object.create(proto);
  ok(installInline(on, true) === null && INLINE.applied === true, 'installed on a renderer that has the getter');
  ok(on.needsFrameBufferTarget === false, 'while on, the renderer needs no frame-buffer target (straight onto the canvas)');
  INLINE.on = false;
  ok(on.needsFrameBufferTarget === true, "while off, the renderer's own getter answers (three's frame-buffer target and output pass)");
  INLINE.on = true;
  ok(Object.getPrototypeOf(on) === proto && Object.getOwnPropertyDescriptor(proto, 'needsFrameBufferTarget')?.get !== undefined, "the prototype's getter is left as it is: the switch is on the renderer itself");
}

// ---------------------------------------------------------------- 7. the water's coverage warmed as it is drawn (step 6's fixer)
{
  // Warmed through the chain's orthographic camera on a triangle of positions alone, every new chain built the coverage's
  // pipeline at its first frame with water in view (a perspective camera's render context, the twins' own attributes).
  const { GpuSsaoPass, geometryLayout } = await import(at('core/gpu/gpuSsaoPass.ts'));
  const { default: RenderObject } = await import('three/src/renderers/common/RenderObject.js');
  const threeKey = (g: THREE.BufferGeometry): string => (RenderObject as Any).prototype.getGeometryCacheKey.call({ geometry: g });
  const lake = new THREE.BufferGeometry();
  lake.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1], 3));
  lake.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  lake.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  const river = lake.clone();
  river.setAttribute('color', new THREE.Uint8BufferAttribute([255, 0, 0, 255, 0, 0, 255, 0, 0], 3, true));
  const sea = lake.clone();
  for (const g of [lake, river, sea]) ok(geometryLayout(g) === threeKey(g), `water: a geometry's layout is three's own geometry key (${threeKey(g)})`);
  ok(geometryLayout(lake) === geometryLayout(sea) && geometryLayout(lake) !== geometryLayout(river), 'water: two geometries of one layout are one layout, a colour attribute another');
  const maskScene = new THREE.Scene();
  for (const g of [lake, lake, river, sea]) maskScene.add(new THREE.Mesh(g));
  const water = { maskScene, syncTwins: () => 0 };
  const gpuHost = { hasProduct: () => false, createRegionTarget: () => new THREE.WebGLRenderTarget(1, 1) };
  const p = new GpuSsaoPass(gpuHost as never, water as never, { reversedDepthBuffer: true }) as Any;
  const items = (p.materials() as Any[]).filter((it) => it.material?.name === 'fx.gpu.ssao.water');
  const layouts = items.map((it) => geometryLayout(it.object.geometry));
  ok(items.length === 3 && new Set(layouts).size === 3 && layouts.includes(geometryLayout(lake)) && layouts.includes(geometryLayout(river)), `water: one coverage item a layout the twins carry, and the triangle of positions alone (${layouts.join(' | ')})`);
  ok(items.every((it) => it.camera === p.waterCam && it.camera.isPerspectiveCamera === true && it.into === p.region && it.object.material === p.waterMaterial), 'water: each warmed through the very perspective camera it is drawn with, into the region target, on its own material');
  ok(items.filter((it) => it.object.geometry === lake || it.object.geometry === river).every((it) => it.object.frustumCulled === false), "water: the stand-ins share the world's geometries and are never culled out of a warm");
  const none = new GpuSsaoPass(gpuHost as never, null, { reversedDepthBuffer: true }) as Any;
  const alone = (none.materials() as Any[]).filter((it) => it.material?.name === 'fx.gpu.ssao.water');
  ok(alone.length === 1 && alone[0].camera === none.waterCam, 'water: with no water source, the triangle alone, through the perspective camera');
}

console.log(PRINT ? '(printed)' : `gpuSsao: ${checks} checks passed`);
