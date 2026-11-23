// The GPU port's step 5, items 1 and 2, in node: the node graphs the ground's tile program, the version-3 ground and the
// far rings build on WebGPU (`src/core/gpu/gpuGround.ts`), held to their structure, since node draws nothing (the browser's
// `__debug.groundSelfTest()` and `__debug.horizon({ selfTest: true })` on WebGPU hold the pixels and the arithmetic).
//
//  1. every uniform the graphs read is the very object the WebGL program reads (`GroundTileUniforms`, `RingUniforms`), in
//     the shared render group, and every texture a live base over the very `{ value }` the world rebinds, its samples one
//     binding (clones referring to the base) that take the world's picture once a render;
//  2. every number the functions are built from is the mirrors' (the curve and the floors `groundMath.ts` writes out, held by
//     running its functions at their edges against `GROUND_SRGB` and `GROUND_FLOORS`, the
//     cloud layer's, `LUMA`; `horizonMath.ts`'s `LEAF`/`PATCH`; `ALBEDO_SCALE`), and no other of their own;
//  3. the materials: the tile program's normal and roughness read the shared bump property and the very shine and frame
//     objects, its lighting model is three's physical one with the flat shine and the diffuse given back, the rings' vertex
//     stage is a position node (`ringVertexN`, the composition the browser's self test runs whole), every derivative and
//     the rings' flat face taken at the top of the colour stage (never inside a branch), and the version-3 program's lookups
//     are its own arrays;
//  4. the composition window's picture is made RGBA32UI on WebGPU in place (`widenWindowTex`), its numbers the same.
//
// Run: node tools/swg/tests/gpuGround.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { PhysicalLightingModel } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { vec2, vec3 } from 'three/tsl';
import { CLOUD_GREY, CLOUD_METRES, CLOUD_PERIOD, LUMA, bumpNormal, cloudShade, srgbDecode, srgbEncode, tintGammaOf } from '../../../src/world/groundMath.ts';
import { TILE_ROUGHNESS } from '../../../src/world/terrainTextures.ts';
import { makeGroundTileUniforms } from '../../../src/world/terrainTextures.ts';
import { makeRingUniforms, widenWindowTex } from '../../../src/world/horizon/horizonRings.ts';
import { LEAF, PATCH } from '../../../src/world/horizon/horizonMath.ts';
import { ALBEDO_SCALE } from '../../../src/world/horizon/horizonDecode.ts';
import {
  GROUND_FLOORS,
  GROUND_GRAPH_NUMBERS,
  GROUND_SRGB,
  GroundLightingModel,
  LiveTexture,
  bakeHeightN,
  groundCloudShade,
  groundDecode,
  groundEncode,
  groundFamiliesNode,
  groundNodes,
  groundTilesNode,
  groundTintOf,
  liveTexture,
  ringDistLevelN,
  ringEdgeLevelN,
  ringLevelOfN,
  ringMorphN,
  ringNode,
  ringNodes,
  tileNormalW,
} from '../../../src/core/gpu/gpuGround.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
let checks = 0;
const ok = (cond: unknown, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
  console.log(`ok   ${msg}`);
};

/** Every node reachable from `root` through three's own children, each once. */
function graph(root: Any): Any[] {
  const seen = new Set<Any>();
  const walk = (n: Any): void => {
    if (!n || typeof n !== 'object' || seen.has(n)) return;
    seen.add(n);
    if (typeof n.getChildren === 'function') for (const c of n.getChildren()) walk(c);
  };
  walk(root);
  return [...seen];
}
// A constant's numbers: a float's own, a vector's components (`vec3(2.4)` is one const node holding a vector).
const constsOf = (root: Any): number[] =>
  graph(root)
    .filter((n) => n.isConstNode)
    .flatMap((n) => (typeof n.value === 'number' ? [n.value] : n.value && typeof n.value === 'object' ? ['x', 'y', 'z', 'w'].map((k) => n.value[k]).filter((v) => typeof v === 'number') : []));
const uniformValues = (root: Any): Set<Any> => new Set(graph(root).filter((n) => n.isUniformNode && !n.isTextureNode).map((n) => n.value));
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b));
const hasConst = (list: number[], v: number) => list.some((x) => close(x, v));

// ---------------------------------------------------------------- 1. the uniforms are the WebGL program's own objects
const u = makeGroundTileUniforms();
const g = groundNodes(u);
for (const k of ['frame', 'tint', 'tintRef', 'look', 'shine', 'cloud', 'tri', 'relief'] as const) {
  const name = { frame: 'uGroundFrame', tint: 'uGroundTint', tintRef: 'uGroundTintRef', look: 'uGroundLook', shine: 'uGroundShine', cloud: 'uGroundCloud', tri: 'uGroundTri', relief: 'uGroundRelief' }[k] as keyof typeof u;
  ok(g[k].value === u[name].value, `the tile program's ${k} is the very ${name} object the WebGL program reads`);
  ok(g[k].groupNode?.name === 'render', `the tile program's ${k} is in the shared render group (one write a render, a still mesh included)`);
}
for (const [k, name] of [['ground', 'uGround'], ['bump', 'uGroundBump'], ['mask', 'uGroundMask'], ['clouds', 'uGroundClouds']] as const) {
  ok(g[k] instanceof LiveTexture && g[k].source === u[name] && g[k].value === u[name].value, `the tile program's ${k} is a live base over the very ${name} the world rebinds`);
}
// A sample is a clone that refers to its base (one binding), and takes the world's new picture once a render, through to the base.
{
  const first = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const src = { value: first as THREE.Texture | null };
  const base = liveTexture(src, first);
  const s = base.sample(vec2(0.5, 0.5)).grad(vec2(0), vec2(0));
  ok(s instanceof LiveTexture && s.getBase() === base && s.source === src && s.updateMatrix === false, "a live texture's sample is a clone referring to its base, with the source and no texture matrix");
  const fresh = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  src.value = fresh;
  s.update();
  ok(base.value === fresh && s.value === fresh, "a sample's render update takes the world's new picture and writes it through to the base (every sample of it follows)");
  src.value = null;
  s.update();
  ok(base.value === first, 'a picture the world set back to null takes the stand-in it was made with (WebGPU cannot bind nothing, WebGL binds its empty picture)');
}
const r0 = makeRingUniforms();
const rn = ringNodes(r0);
for (const [k, name] of [['eye', 'uHorizonEye'], ['square', 'uHorizonSquare'], ['morph', 'uHorizonMorph'], ['drop', 'uHorizonDrop'], ['grid', 'uHorizonGrid'], ['fine', 'uHorizonFine'], ['coarse', 'uHorizonCoarse'], ['colour', 'uHorizonColour'], ['sizes', 'uHorizonSizes'], ['colourN', 'uHorizonColourN'], ['look', 'uHorizonLook'], ['fade', 'uHorizonFade'], ['shape', 'uHorizonShape'], ['shapeWin', 'uHorizonShapeWin'], ['shapeAt', 'uHorizonShapeAt'], ['win', 'uHorizonWin'], ['winC', 'uHorizonWinC'], ['dome', 'uRingDome'], ['clear', 'uClear'], ['horizonFog', 'uHorizonFog']] as const) {
  ok((rn as Any)[k].value === (r0 as Any)[name].value && (rn as Any)[k].groupNode?.name === 'render', `the rings' ${k} is the very ${name} object, in the shared render group`);
}
for (const [k, name] of [['heights', 'uHorizonHeights'], ['fineN', 'uHorizonFineN'], ['albedo', 'uHorizonAlbedo'], ['coarseAlbedo', 'uHorizonCoarseAlbedo'], ['window', 'uHorizonWindow'], ['tintWin', 'uHorizonTint'], ['gradient', 'uGradient'], ['gradient2', 'uGradient2']] as const) {
  ok((rn as Any)[k] instanceof LiveTexture && (rn as Any)[k].source === (r0 as Any)[name], `the rings' ${k} is a live base over the very ${name}`);
}

// ---------------------------------------------------------------- 2. the mirrors' numbers
ok(GROUND_GRAPH_NUMBERS.srgb === GROUND_SRGB && GROUND_GRAPH_NUMBERS.floors === GROUND_FLOORS && GROUND_GRAPH_NUMBERS.luma === LUMA, "the graphs' sRGB curve, floors and luminance are the named records (the luminance groundMath's own)");
// The mirror writes the curve and the floors out as numbers (it stays 28fdb7c's to the byte): its own functions, run at
// and about every edge, give what the records say to the bit, so a record off by anything fails here.
const SR = GROUND_SRGB;
const FL = GROUND_FLOORS;
{
  const up = (x: number) => x + Math.max(Number.MIN_VALUE, Math.abs(x) * Number.EPSILON);
  const dec = (c: number) => (c <= SR.below ? c / SR.slope : Math.pow((c + SR.offset) / SR.scale, SR.power));
  const enc = (c: number) => (c <= SR.encodeBelow ? c * SR.slope : SR.scale * Math.pow(c, 1 / SR.power) - SR.offset);
  const cs = [0, SR.below, up(SR.below), SR.encodeBelow, up(SR.encodeBelow), 0.5, 1, 1.7, ...Array.from({ length: 64 }, (_, i) => (i + 0.5) / 32)];
  ok(cs.every((c) => Object.is(srgbDecode(c), dec(c))), "groundMath's srgbDecode is GROUND_SRGB's curve to the bit, at its edge and about it");
  ok(cs.filter((c) => c <= 1).every((c) => Object.is(srgbEncode(c), enc(c))), "groundMath's srgbEncode is GROUND_SRGB's curve to the bit, at its edge and about it");
  ok(SR.encodeFloor < SR.encodeBelow, "the encode floor (1e-6, the graph's own guard of pow on the arm it never takes) is under the curve's edge");
  const tiny = [1e-9, 2e-9, 3e-9] as [number, number, number];
  const ref = { rgb: [1e-9, 1e-9, 1e-9] as [number, number, number], luminance: 1e-9 };
  const out: [number, number, number] = [0, 0, 0];
  tintGammaOf(tiny, { mode: 2, ref, cap: 1.5 }, out);
  const lum = tiny[0] * LUMA[0] + tiny[1] * LUMA[1] + tiny[2] * LUMA[2];
  const gain = Math.min(1 / Math.max(ref.luminance, FL.tintRef), 1.5 / Math.max(lum, FL.tintLum));
  ok(out.every((v, i) => Object.is(v, tiny[i] * gain)), "groundMath's normalised tint holds its divisions off GROUND_FLOORS' tintRef and tintLum");
  tintGammaOf(tiny, { mode: 3, ref, cap: 1.5 }, out);
  ok(out.every((v, i) => Object.is(v, Math.min(tiny[i] / Math.max(ref.rgb[i], FL.tintRef), 1.5))), "groundMath's per-channel tint holds its division off GROUND_FLOORS' tintRef");
  const n: [number, number, number] = [0, 0, 0];
  bumpNormal([0.7, 0.3, 0.4], 1, 1, n);
  const sx = (-(0.7 * 2 - 1) / FL.bumpZ) * -1;
  const sz = -(0.3 * 2 - 1) / FL.bumpZ;
  const len = Math.hypot(sx, 1, sz);
  ok(Object.is(n[0], -sx / len) && Object.is(n[1], 1 / len) && Object.is(n[2], -sz / len), "groundMath's bump lean holds its depth off GROUND_FLOORS' bumpZ");
  ok(Object.is(cloudShade(0, 1, 1), Math.min(1, srgbDecode(CLOUD_GREY) / FL.cloudBase)), "groundMath's cloud shade holds its division off GROUND_FLOORS' cloudBase");
  ok(TILE_ROUGHNESS.includes(`, ${FL.rough}, 1.0 )`), "the tile program's roughness floor is GROUND_FLOORS' rough");
}
ok(GROUND_GRAPH_NUMBERS.cloudGrey === CLOUD_GREY && GROUND_GRAPH_NUMBERS.cloudMetres === CLOUD_METRES && GROUND_GRAPH_NUMBERS.cloudPeriod === CLOUD_PERIOD, "the cloud layer's grey, scale and period are groundMath's");
ok(GROUND_GRAPH_NUMBERS.quad === LEAF / PATCH && GROUND_GRAPH_NUMBERS.patch === PATCH && GROUND_GRAPH_NUMBERS.albedoScale === ALBEDO_SCALE, "the ring's quad, patch and albedo scale are horizonMath's and the decode's");
// The mirror's functions run on the same records (srgbDecode/srgbEncode at the curve's own edges).
{
  const dec = constsOf(groundDecode(vec3(0.5)));
  for (const v of [1 / SR.slope, SR.offset, 1 / SR.scale, SR.power, SR.below]) ok(hasConst(dec, v), `the decode's graph holds the curve's ${v}`);
  const enc = constsOf(groundEncode(vec3(0.5)));
  for (const v of [SR.slope, SR.encodeFloor, 1 / SR.power, SR.scale, SR.offset, SR.encodeBelow]) ok(hasConst(enc, v), `the encode's graph holds the curve's ${v}`);
  const tint = groundTintOf(vec3(0.5), g.tint, g.tintRef);
  const tc = constsOf(tint);
  for (const v of [...LUMA, FL.tintRef, FL.tintLum]) ok(hasConst(tc, v), `the tint's graph holds the mirror's ${v}`);
  const tu = uniformValues(tint);
  ok(tu.has(u.uGroundTint.value) && tu.has(u.uGroundTintRef.value), "the tint reads the very tint and reference vectors");
  const cl = groundCloudShade(g, vec3(0.5), vec2(0));
  const cc = constsOf(cl);
  for (const v of [4 / CLOUD_METRES, 1 / CLOUD_PERIOD, CLOUD_GREY, FL.cloudBase]) ok(hasConst(cc, v), `the clouds' graph holds the mirror's ${v}`);
  ok(uniformValues(cl).has(u.uGroundCloud.value), "the clouds read the very cloud vector (on, strength, clock)");
  const nw = tileNormalW(g, vec3(0.5), vec3(0, 1, 0));
  ok(hasConst(constsOf(nw), FL.bumpZ), "the bump's lean holds the mirror's floor");
  const nu = uniformValues(nw);
  ok(nu.has(u.uGroundShine.value) && nu.has(u.uGroundFrame.value), "the bump's lean reads the very shine (its strength) and frame (the mirror) vectors");
  const lv = ringLevelOfN(vec3(0).x, rn.morph.x, rn.morph.y, rn.shape, rn.shapeAt.w);
  ok(uniformValues(lv).has(r0.uHorizonShape.value) && uniformValues(lv).has(r0.uHorizonMorph.value), "the rings' level reads the very shape and morph vectors");
  ok(hasConst(constsOf(ringMorphN(vec3(1).x, vec3(0).x, vec3(1).x, vec3(0).x)), LEAF / PATCH), "the morph's lattice is the leaf over the patch");
  ok(graph(ringDistLevelN(vec3(1).x, vec3(1).x, vec3(1).x)).length > 0 && graph(ringEdgeLevelN(vec3(1).x, vec3(1).x, vec3(1).x)).length > 0, 'the level functions build');
  const bh = bakeHeightN(rn, vec3(0).x, vec3(0).x);
  // The loads are clones referring to the base (which the walk meets through them too, as the binding they share).
  const loads = graph(bh).filter((n) => n.isTextureNode && n !== rn.heights);
  ok(loads.length > 0 && loads.every((n) => n.sampler === false && n.getBase() === rn.heights), "the bake's heights are loads of the one heights base (no sampler, one binding)");
}

// ---------------------------------------------------------------- 3. the materials
{
  const m = groundTilesNode(u) as Any;
  ok(m.isMeshStandardNodeMaterial === true && m.name === 'gpu: the ground tile program', "the tile program is a standard node material of its own");
  const ru = uniformValues(m.roughnessNode);
  ok(ru.has(u.uGroundShine.value), "the tile program's roughness reads the very shine vector (the gloss's highlight share)");
  ok(hasConst(constsOf(m.roughnessNode), FL.rough), "the roughness is held at the mirror's floor");
  const nu = uniformValues(m.normalNode);
  ok(nu.has(u.uGroundShine.value) && nu.has(u.uGroundFrame.value), "the tile program's normal reads the very shine and frame vectors");
  const props = graph(m.normalNode).filter((n) => n.isPropertyNode).map((n) => n.name);
  ok(props.includes('gGroundBump'), "the normal reads the composition's bump through the shared property, as the WebGL text reads its global");
  const model = m.setupLightingModel();
  ok(model instanceof GroundLightingModel && model instanceof (PhysicalLightingModel as Any) && model.flat?.name === 'gGroundFlat', "the tile program's lighting model is three's physical one with the flat shine read off the shared property");
  ok(m.colorNode?.isShaderCallNodeInternal === true || typeof m.colorNode === 'object', "the colour is a node (the composition, built where three builds the diffuse colour)");
}
{
  const tex = new THREE.DataArrayTexture(new Uint8Array(4 * 3), 1, 1, 3);
  const layerOf = new Float32Array([0, 2, 1]);
  const sizeOf = new Float32Array([4, 8, 16]);
  const m = groundFamiliesNode({ texture: tex, layerOf, sizeOf, normals: null, normalScale: { value: 1 }, glossScale: { value: 1 } }) as Any;
  const arrays = graph(m.colorNode).filter((n) => n.isUniformArrayNode);
  ok(m.name === 'gpu: the ground (version 3)', 'the version-3 ground is a node material of its own');
  ok(m.roughnessNode?.value === 1 || constsOf(m.roughnessNode).includes(1), 'with no bumps it is matt, as the WebGL program');
  ok(arrays.length === 0 || arrays.every((a) => a.array.length === 3), "its lookups are the world's own arrays, a family each");
}
{
  const ru = makeRingUniforms();
  const m = ringNode(ru, makeGroundTileUniforms()) as Any;
  ok(m.name === 'gpu: the far rings' && m.positionNode && m.normalNode && m.roughnessNode, 'the rings are a node material with a vertex stage, a normal and a roughness of their own');
  ok(m.setupLightingModel() instanceof GroundLightingModel, "the rings' lighting is the ground's (the near composition's flat shine)");
  // A `select` of three's nodes is written out as an `if`, and a derivative first read inside one is undefined wherever the
  // quad's lanes part: the rings' normal takes none of its own and no flat face, but reads the ones the colour stage takes at
  // its top (a NaN face along every silhouette past the fine extent, the dashed line from 500 m over Naboo, was this).
  const ng = graph(m.normalNode);
  ok(!ng.includes(TSL.normalWorldGeometry) && !ng.includes(TSL.normalFlat) && !ng.some((n) => n.isMathNode && /^dFd[xy]$/.test(n.method)), "the rings' normal builds no derivative and no flat face of its own");
  ok(['gRingFaceW', 'gRingDx', 'gRingDy'].every((p) => ng.some((n) => n.isPropertyNode && n.name === p)), "the rings' normal reads the flat face and the place's derivatives through the colour stage's properties");
  // Read with its line ends as git keeps them (a checkout made with `core.autocrlf` has CRLF, and the window below is cut on
  // a newline).
  const src = readFileSync(new URL('../../../src/core/gpu/gpuGround.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const top = src.slice(src.indexOf('m.colorNode = Fn(() => {\n    GROUND_GPU_STATS.builds.rings++;'));
  const first = top.slice(0, top.indexOf('const tileDx'));
  ok(['rdx.assign(dFdx(v.raw));', 'rdy.assign(dFdy(v.raw));', 'face.assign(normalWorldGeometry);', 'uvDx.assign(dFdx(v.uv));', 'uvDy.assign(dFdy(v.uv));', 'yd.assign(vec2(dFdx(v.y), dFdy(v.y)));'].every((l) => first.includes(l)), "the rings' colour stage takes every derivative and the face at its very top, before any branch");
  const tiles = src.slice(src.indexOf('GROUND_GPU_STATS.builds.tiles++;'), src.indexOf('let uv: Any = vUV;'));
  ok(['dx.assign(dFdx(vUV));', 'dy.assign(dFdy(vUV));', 'tx.assign(dFdx(vTile));', 'ty.assign(dFdy(vTile));', 'yd.assign(vec2(dFdx(vY), dFdy(vY)));'].every((l) => tiles.includes(l)), "the tile program's colour stage takes its derivatives at its top too, before the relief's branch");
  ok(src.includes("const o = ringVertexN(r, g.frame, attribute('aRing', 'vec4'), positionGeometry);"), "the rings' vertex stage is ringVertexN, the composition the self test runs");
  const selfTest = readFileSync(new URL('../../../src/core/gpu/gpuGroundSelfTest.ts', import.meta.url), 'utf8');
  ok(selfTest.includes('const o = ringVertexN(r, fr, A.element(i), B.element(i));') && selfTest.includes('out.vertex = await ringVertexCheck(renderer);') && /vx\.ok === true/.test(selfTest), "horizon({ selfTest }) runs ringVertexN whole on the GPU and fails without it");
}

// ---------------------------------------------------------------- 4. the composition window's picture on WebGPU
{
  const data = new Uint16Array([1, 2, 300, 65535]);
  const t = new THREE.DataTexture(data as never, 1, 1, THREE.RGBAIntegerFormat, THREE.UnsignedShortType);
  t.internalFormat = 'RGBA16UI';
  widenWindowTex(t);
  const d = (t.image as Any).data as Uint32Array;
  ok(d instanceof Uint32Array && [...d].join() === '1,2,300,65535' && t.type === THREE.UnsignedIntType && t.internalFormat === null, 'the window is widened to RGBA32UI in place, its numbers the same, with no WebGL format name');
  widenWindowTex(t);
  ok((t.image as Any).data === d, 'widening twice changes nothing');
}

console.log(`gpuGround: ${checks} checks passed`);
