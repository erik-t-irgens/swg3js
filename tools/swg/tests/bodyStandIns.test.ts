// The GPU port's pass 1, wave 4, item 3 (`A:\swg3js\port\PASS1-W4.md`): the person warm's stand-ins made off real bodies
// (`src/core/gpu/bodyStandIns.ts`), held to three's own keys.
//
//  1. three's own keys, run as the build's text (`RenderObject.getMaterialCacheKey` with its `getKeys`, `getInstanceDataKey`
//     and `_enumProperties`, `getGeometryCacheKey`, and `hashString` from `three/tsl`): a stand-in learnt off a body is keyed
//     by three exactly as the body is (after the world's adoption wraps its copy as it wrapped the body's), while
//     `personKeys.ts`'s one-bone stand-in of the same shape is keyed apart from every body (the 36 pipelines of the census);
//  2. what is learnt: two bodies drawn one way make one stand-in; a picture of another sampler state, another bone count, a
//     rack weapon each another; a body still morphed, several materials and a cube's picture are left out, by why; the
//     cap holds; the switch off answers none;
//  3. the stand-in itself: its layout's triangle, its bone count, its shadows, its pictures one-texel twins of their sampler
//     state and colour space shared between stand-ins, the environment the body's own.
//
// Run: node tools/swg/tests/bodyStandIns.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { hashString } from 'three/tsl';
import { BODY_STAND_IN_STATS, BODY_STAND_INS_TUNE, bodyKey, bodyStandIns, learnBodies, resetBodyStandInsForTests } from '../../../src/core/gpu/bodyStandIns.ts';
import { GPU_KEYS } from '../../../src/core/gpu/gpuKeys.ts';
import { signatureStandIns } from '../../../src/world/personKeys.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
let checks = 0;
const ok = (cond: unknown, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
};

// ---------------------------------------------------------------- three's own keys, out of the build the game loads
const req = createRequire(import.meta.url);
const build = readFileSync(join(dirname(req.resolve('three')), '..', 'build', 'three.webgpu.js'), 'utf8');
/** A top-level function or class method's text, from its first line to its closing brace at that indent. */
function cut(start: string, indent: string): string {
  const at = build.indexOf(start);
  assert.ok(at >= 0, `the build holds ${start.trim()}`);
  const end = build.indexOf(`\n${indent}}\n`, at);
  return build.slice(at, end + indent.length + 2);
}
const enumLine = build.slice(build.indexOf('const _enumProperties = '), build.indexOf('\n', build.indexOf('const _enumProperties = ')));
const helpers = [build.slice(build.indexOf('const _protoKeysCache = '), build.indexOf('\n', build.indexOf('const _protoKeysCache = '))), enumLine, cut('function getKeys( obj ) {', ''), cut('function getInstanceDataKey( attribute ) {', '')].join('\n');
const methodBody = (name: string): string => {
  const text = cut(`\t${name}() {`, '\t');
  return text.slice(text.indexOf('{') + 1, text.lastIndexOf('}'));
};
const keyFns = new Function('hashString', `${helpers}\nreturn { geometry: function () {${methodBody('getGeometryCacheKey')}}, material: function () {${methodBody('getMaterialCacheKey')}} };`)(hashString) as { geometry: (this: Any) => string; material: (this: Any) => number };

/** Three's material key of an object as a WebGPU render object works it out (the program key's text through the material's own). */
function threeKey(o: THREE.Mesh): number {
  const ro: Any = {
    object: o,
    material: o.material,
    geometry: o.geometry,
    scene: null,
    renderer: { backend: { isWebGPUBackend: true }, currentSamples: 4 },
    _nodes: { getCustomProgramCacheKey: (m: Any) => m.customProgramCacheKey() },
    clippingContextCacheKey: 'clip',
    context: { buildKey: 'ctx' },
  };
  ro.getGeometryCacheKey = keyFns.geometry;
  return keyFns.material.call(ro);
}

/** The world's adoption as far as a key sees it: a wrap of ours hung on the material (`World.adoptMaterials`'s, every material alike). */
function adopt(m: THREE.Material): void {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = function wrapped(shader, r) {
    prev.call(this, shader, r);
    (shader as Any).swgWrapped = true;
  };
}

// ---------------------------------------------------------------- bodies as the game draws them
const picture = (o: { nearest?: boolean; srgb?: boolean } = {}): THREE.Texture => {
  const t = new THREE.Texture();
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.magFilter = o.nearest ? THREE.NearestFilter : THREE.LinearFilter;
  t.minFilter = o.nearest ? THREE.NearestFilter : THREE.LinearMipmapLinearFilter;
  if (o.srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
};
const flat = new THREE.DataTexture(new Float32Array([0.5, 0.5, 1, 1]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
flat.magFilter = THREE.NearestFilter;
flat.minFilter = THREE.NearestFilter;
const env = new THREE.CubeTexture();
const material = (o: { map?: THREE.Texture; side?: THREE.Side; cut?: boolean } = {}): THREE.MeshStandardMaterial => {
  const m = new THREE.MeshStandardMaterial({ map: o.map ?? picture({ srgb: true }), normalMap: flat, roughnessMap: picture(), metalnessMap: picture(), side: o.side ?? THREE.FrontSide, alphaTest: o.cut ? 0.5 : 0 });
  m.envMap = env;
  m.userData.swgSpec = { mode: 'phong', color: [1, 1, 1], power: 8 };
  adopt(m);
  return m;
};
function bodyMesh(m: THREE.Material, bones = 53, vertices = 30): THREE.SkinnedMesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(vertices * 3), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(vertices * 2), 2));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(new Float32Array(vertices * 4), 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(vertices * 4), 4));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array(vertices), 1));
  const s = new THREE.SkinnedMesh(g, m);
  const list: THREE.Bone[] = [];
  for (let i = 0; i < bones; i++) {
    const b = new THREE.Bone();
    if (i) list[i - 1].add(b);
    list.push(b);
  }
  s.add(list[0]);
  s.bind(new THREE.Skeleton(list));
  s.castShadow = true;
  s.receiveShadow = true;
  return s;
}

// ---------------------------------------------------------------- 1 and 2. what is learnt, keyed as three keys the bodies
{
  resetBodyStandInsForTests();
  const scene = new THREE.Scene();
  const look = material();
  const a = bodyMesh(look);
  const b = bodyMesh(material());
  const nearest = bodyMesh(material({ map: picture({ nearest: true, srgb: true }) }));
  const fifty = bodyMesh(material(), 50);
  const doubleCut = bodyMesh(material({ side: THREE.DoubleSide, cut: true }));
  const rackMat = material();
  rackMat.userData.swgRack = true;
  const rack = new THREE.Mesh(a.geometry.clone().deleteAttribute('skinIndex').deleteAttribute('skinWeight'), rackMat);
  rack.castShadow = true;
  rack.receiveShadow = true;
  const morphed = bodyMesh(material());
  morphed.geometry.morphAttributes.position = [new THREE.BufferAttribute(new Float32Array(90), 3)];
  const several = bodyMesh(material());
  several.material = [material(), material()];
  const cubeMap = material();
  (cubeMap as Any).map = new THREE.CubeTexture();
  const cubed = bodyMesh(cubeMap);
  const plain = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  scene.add(a, b, nearest, fifty, doubleCut, rack, morphed, several, cubed, plain);
  const n = learnBodies(scene);
  const list = bodyStandIns(null)!;
  ok(n === 5 && list.length === 5, `five ways of drawing a body learnt (${n}): two bodies of one way make one stand-in; another sampler state, another bone count, another side and cut, a rack weapon each another`);
  ok(BODY_STAND_IN_STATS.left['morph targets (its geometry its own pipeline)'] === 1 && BODY_STAND_IN_STATS.left['several materials'] === 1 && BODY_STAND_IN_STATS.left['a picture of another kind, or interleaved attributes'] === 1, 'a body still morphed, several materials and a cube picture are left out, by why');
  // Each stand-in adopted by the world as a body's copy is (the same wrap on it), then keyed by three's own text.
  for (const s of list) adopt(s.material as THREE.Material);
  const byKey = new Map(list.map((s) => [s.userData.swgBodyKey as string, s]));
  for (const [name, body] of [['a body', a], ['a body of the same way', b], ['a nearest-filtered map', nearest], ['50 bones', fifty], ['two-sided and cut', doubleCut], ['a rack weapon', rack]] as [string, THREE.Mesh][]) {
    const s = byKey.get(bodyKey(body)!)!;
    ok(!!s, `${name}: its stand-in is the one learnt for its way`);
    ok(keyFns.geometry.call({ geometry: s.geometry }) === keyFns.geometry.call({ geometry: body.geometry }), `${name}: three's geometry key of the stand-in is the body's`);
    ok(threeKey(s) === threeKey(body), `${name}: three's material key of the stand-in is the body's (its bones, its samplers, its shadows, its program text)`);
  }
  ok(threeKey(byKey.get(bodyKey(a)!)!) !== threeKey(nearest) && threeKey(byKey.get(bodyKey(a)!)!) !== threeKey(fifty), 'and three keys the ways apart');
  // personKeys' own stand-in of the shape (rung 0, front, opaque) is keyed apart from every body: what the census counted.
  const old = signatureStandIns().find((s) => s.name === 'personKeys:person r0 front opaque')!;
  ok(!!old && [a, b, nearest, fifty].every((body) => threeKey(old) !== threeKey(body)), "personKeys' one-bone stand-in of the shape builds a pipeline no body draws with");
  // Learnt again, nothing is new.
  ok(learnBodies(scene) === 0 && bodyStandIns(scene)!.length === 5, 'walked again, nothing is learnt twice');
  // The switch off: none (the warm takes personKeys' own).
  GPU_KEYS.realStandIns = false;
  ok(bodyStandIns(scene) === null, 'with the switch off the warm is answered none');
  GPU_KEYS.realStandIns = true;
}

// ---------------------------------------------------------------- 3. the stand-in itself
{
  resetBodyStandInsForTests();
  const scene = new THREE.Scene();
  const body = bodyMesh(material(), 53, 300);
  const other = bodyMesh(material({ side: THREE.BackSide }), 53, 120);
  scene.add(body, other);
  const [s, t] = bodyStandIns(scene)! as THREE.SkinnedMesh[];
  ok(s.isSkinnedMesh && s.skeleton.bones.length === 53, 'a skinned stand-in on as many bones as its body');
  ok(s.geometry.attributes.position.count === 3 && Object.keys(s.geometry.attributes).sort().join() === Object.keys(body.geometry.attributes).sort().join(), "a triangle of the body's very attributes");
  ok(s.geometry.index!.array instanceof Uint16Array, "its index of the body's index's kind");
  ok(s.castShadow && s.receiveShadow && s.frustumCulled === false, 'it casts and receives as the body does');
  const sm = s.material as THREE.MeshStandardMaterial;
  const bm = body.material as THREE.MeshStandardMaterial;
  ok(sm !== bm && sm.userData.swgStandIn === true, "a copy of the body's material, marked as ours");
  for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap'] as const) {
    const tw = sm[k]!;
    const real = bm[k]!;
    ok(tw !== real && (tw.image as { width: number }).width === 1 && tw.magFilter === real.magFilter && tw.minFilter === real.minFilter && tw.wrapS === real.wrapS && tw.wrapT === real.wrapT && tw.colorSpace === real.colorSpace && tw.mapping === real.mapping && tw.channel === real.channel, `${k}: a one-texel twin of the body's picture's sampler state and colour space`);
  }
  ok((sm.normalMap as THREE.DataTexture).type === THREE.FloatType, 'a float picture twinned as a float one (three samples it unfiltered all the same)');
  ok(sm.envMap === bm.envMap, 'the environment the body wears (the registry hands both the same)');
  const tm = t.material as THREE.MeshStandardMaterial;
  ok(tm.map === sm.map && tm.roughnessMap === sm.roughnessMap && t.geometry === s.geometry && t.skeleton.bones[0] === s.skeleton.bones[0], 'two stand-ins share their twins, their layout and their bones');
  ok(BODY_STAND_INS_TUNE.cap === 64, 'the cap is ours: 64 ways a session');
  // The cap holds.
  BODY_STAND_INS_TUNE.cap = 2;
  const more = bodyMesh(material({ cut: true }));
  scene.add(more);
  ok(learnBodies(scene) === 0 && BODY_STAND_IN_STATS.pastCap === 1, 'a way met past the cap is counted and not learnt');
  BODY_STAND_INS_TUNE.cap = 64;
}

console.log(`bodyStandIns: ${checks} checks passed`);
