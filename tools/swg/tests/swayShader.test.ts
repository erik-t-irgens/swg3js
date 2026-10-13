// The flora sway's chunk in three's own programs (`src/world/floraSway.ts`, `src/world/swayMath.ts`):
//
//   1. through the very hook chain `World.adoptMaterials` builds (the cascades' hook, the wet look, the highlight,
//      the leaf cards' rule, then the sway), the colour program of three 0.185's physical shader and the depth
//      program of its depth shader each carry the chunk exactly once, after `begin_vertex` and before
//      `project_vertex`; the wet look's insert comes after `project_vertex`, and the card's leaf capture after the
//      sway, so it reads the swayed place;
//   2. the chunk never reads `cameraPosition` or `viewMatrix`, which in the shadow pass are the cascade's;
//   3. a colour material, its clone and its depth material hand three the very same uniform objects, the shared
//      ones and the model's own, and a material whose model is not in the table is handed a gain of nought;
//   4. two models' depth materials share one program key, and their hooks are one function;
//   5. wrapping twice adds nothing, and a hook the cascades replaced is wrapped again with the same key;
//   6. no name is declared twice in one scope (the blade glow lesson's scanner), with and without instancing, the
//      card light, the leaf skip and the wet look, in the colour program and the depth program;
//   7. the depth warm list holds one stand-in per combination, instanced where its mesh is.
//
// Run: node tools/swg/tests/swayShader.test.ts
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CSMShader } from 'three/examples/jsm/csm/CSMShader.js';
import { LEAF_CAPTURE } from '../../../src/world/cardLight.ts';
import { applyCard, prepareCardModel, registerPackCards } from '../../../src/world/cardRule.ts';
import { wrapsOn, type Wrappable } from '../../../src/world/compileHooks.ts';
import { SWAY_UNIFORMS, disposeStandIn, prepareSwayModel, swayDepthFor, swayDepthStandIns, swayWrap } from '../../../src/world/floraSway.ts';
import { applySpec } from '../../../src/world/specular.ts';
import { SWAY_APPLY, SWAY_PARS } from '../../../src/world/swayMath.ts';
import { applyWetness } from '../../../src/world/wetness.ts';
import { glslVariant, redeclared } from './glslScan.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

type Shader = THREE.WebGLProgramParametersWithUniforms;
const resolve = (s: string): string =>
  s.replace(/^[ \t]*#include +<([\w\d./]+)>/gm, (_m, name: string) => {
    const chunk = (THREE.ShaderChunk as unknown as Record<string, string>)[name];
    if (chunk === undefined) throw new Error(`no chunk ${name}`);
    return resolve(chunk);
  });
const count = (text: string, s: string) => text.split(s).length - 1;

// The game's lights chunk is the cascades' (the cascades install it as they are made).
const keepChunk = THREE.ShaderChunk.lights_fragment_begin;
(THREE.ShaderChunk as unknown as Record<string, string>).lights_fragment_begin = CSMShader.lights_fragment_begin;

/** A hand-built tree as the pack hands it over: a trunk and a crown of cards, ruled and measured as it loads. */
function tree(id: string): { group: THREE.Group; trunk: THREE.MeshStandardMaterial; card: THREE.MeshStandardMaterial; cardMesh: THREE.Mesh; trunkMesh: THREE.Mesh } {
  const group = new THREE.Group();
  const trunk = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
  trunk.name = 'shader/test_bark_as9.sht';
  const card = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), alphaTest: 0.5, side: THREE.DoubleSide });
  card.name = 'shader/test_leaf_aa7.sht';
  const trunkGeometry = new THREE.CylinderGeometry(0.2, 0.3, 8, 6).translate(0, 4, 0);
  const cardGeometry = new THREE.PlaneGeometry(2, 2).translate(0, 7, 0);
  const trunkMesh = new THREE.Mesh(trunkGeometry, trunk);
  const cardMesh = new THREE.Mesh(cardGeometry, card);
  group.add(trunkMesh, cardMesh);
  prepareCardModel([group], { flora: true, count: false }, 'cards');
  prepareSwayModel([group], `test:${id}`, id, { flora: true, building: false });
  return { group, trunk, card, cardMesh, trunkMesh };
}
registerPackCards({ 'shader/test_leaf_aa7.sht': { blend: true, emissive: [0, 0, 0] } });

/** The world's chain on one material, as `adoptMaterials` puts it on. */
function chained(m: THREE.MeshStandardMaterial, wet: boolean): THREE.MeshStandardMaterial {
  m.onBeforeCompile = function cascades(shader: Shader) {
    shader.uniforms.CSM_cascades = { value: [] };
  };
  m.userData.swgSpec = { mode: 'none', color: [0, 0, 0], power: 0, mask: 'unmasked' };
  if (wet) applyWetness(m);
  applySpec(m, false);
  if (m.userData.swgCardBlend !== undefined) applyCard(m);
  swayWrap(m);
  return m;
}
const compiled = (m: THREE.Material, lib: { vertexShader: string; fragmentShader: string; uniforms: Record<string, THREE.IUniform> }): Shader => {
  const s = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: THREE.UniformsUtils.clone(lib.uniforms) } as unknown as Shader;
  m.onBeforeCompile(s, null as unknown as THREE.WebGLRenderer);
  return s;
};

const BEGIN = '#include <begin_vertex>';
const PROJECT = '#include <project_vertex>';
const WET_AFTER_PROJECT = 'vWetPos = (modelMatrix * wetWorld).xyz;';

const a = tree('decd_test_birch');
const b = tree('decd_test_oak');

// ---------------------------------------------------------------- 1. once, in its place

{
  ok(a.card.userData.swgSway === 'test:decd_test_birch' && a.trunk.userData.swgSway === 'test:decd_test_birch' && a.card.userData.swgCardBlend !== undefined, 'every material of a swaying model is marked with its model\'s key, its trunk as well as its cards');
  const card = chained(a.card, true);
  const trunk = chained(a.trunk, true);
  ok(wrapsOn(card as unknown as Wrappable).join('|') === 'wet-object|spec|card|sway' && wrapsOn(trunk as unknown as Wrappable).join('|') === 'wet-object|spec|sway', `the sway is the chain's last wrap (${wrapsOn(card as unknown as Wrappable).join(' > ')})`);
  for (const [name, m] of [['card', card], ['trunk', trunk]] as const) {
    const s = compiled(m, THREE.ShaderLib.physical);
    const v = s.vertexShader;
    const at = v.indexOf(SWAY_APPLY);
    ok(count(v, SWAY_APPLY) === 1 && count(v, SWAY_PARS) === 1 && at > v.indexOf(BEGIN) && at < v.indexOf(PROJECT), `the ${name}'s colour program carries the chunk once, after begin_vertex and before project_vertex`);
    ok(v.indexOf(WET_AFTER_PROJECT) > v.indexOf(PROJECT) && v.indexOf(WET_AFTER_PROJECT) > at, `and the wet look's insert comes after project_vertex, so the rain reads the swayed place`);
  }
  const s = compiled(card, THREE.ShaderLib.physical);
  ok(s.vertexShader.indexOf(LEAF_CAPTURE) > s.vertexShader.indexOf(SWAY_APPLY), "the card's leaf capture comes after the sway, so the leaf skip reads the swayed place");
  const d = swayDepthFor(card);
  const ds = compiled(d, THREE.ShaderLib.depth);
  const dat = ds.vertexShader.indexOf(SWAY_APPLY);
  ok(count(ds.vertexShader, SWAY_APPLY) === 1 && dat > ds.vertexShader.indexOf(BEGIN) && dat < ds.vertexShader.indexOf(PROJECT), 'its depth program carries the very same chunk once, after begin_vertex and before project_vertex');
}

// ---------------------------------------------------------------- 2. nothing view-dependent

{
  const strip = (g: string) => g.replace(/\/\/.*$/gm, '');
  ok(!/\bcameraPosition\b|\bviewMatrix\b/.test(strip(SWAY_PARS)) && !/\bcameraPosition\b|\bviewMatrix\b/.test(strip(SWAY_APPLY)), 'the chunk never reads cameraPosition or viewMatrix: the fade reads the eye of ours');
}

// ---------------------------------------------------------------- 3. the same uniform objects

{
  const colour = compiled(a.card, THREE.ShaderLib.physical).uniforms as Record<string, unknown>;
  const depth = compiled(swayDepthFor(a.card), THREE.ShaderLib.depth).uniforms as Record<string, unknown>;
  const twin = a.card.clone();
  ok(twin.userData.swgSway === a.card.userData.swgSway, "a clone keeps its model's key: it is a string, which a clone's copy of userData keeps");
  swayWrap(twin);
  const cloned = compiled(twin, THREE.ShaderLib.physical).uniforms as Record<string, unknown>;
  const shared = Object.keys(SWAY_UNIFORMS);
  ok(shared.every((k) => colour[k] === (SWAY_UNIFORMS as Record<string, unknown>)[k] && depth[k] === colour[k] && cloned[k] === colour[k]), 'the colour program, its clone and its depth program hand three the shared uniform objects themselves');
  ok(['uSwayShape', 'uSwayAxis'].every((k) => colour[k] && depth[k] === colour[k] && cloned[k] === colour[k]), "and the model's own, one object for every material and copy of the model");
  const trunk = compiled(a.trunk, THREE.ShaderLib.physical).uniforms as Record<string, unknown>;
  const other = compiled(chained(b.card, false), THREE.ShaderLib.physical).uniforms as Record<string, unknown>;
  ok(trunk.uSwayShape === colour.uSwayShape && other.uSwayShape !== colour.uSwayShape, "a model's trunk shares its cards' shape, and another model has its own");
  const stray = new THREE.MeshStandardMaterial();
  stray.userData.swgSway = 'test:nobody';
  swayWrap(stray);
  const none = compiled(stray, THREE.ShaderLib.physical).uniforms as Record<string, { value: THREE.Vector4 }>;
  ok(none.uSwayShape.value.w === 0, 'a material whose model is not in the table is handed a gain of nought, and its program text is the same');
}

// ---------------------------------------------------------------- 4. one depth program key

{
  const da = swayDepthFor(a.card);
  const db = swayDepthFor(b.card);
  const dt = swayDepthFor(a.trunk);
  ok(da !== db && da.customProgramCacheKey() === db.customProgramCacheKey() && db.customProgramCacheKey() === dt.customProgramCacheKey() && da.onBeforeCompile === db.onBeforeCompile, `two models' depth materials share one program key ('${da.customProgramCacheKey()}') and one hook`);
  ok(swayDepthFor(a.card) === da, 'and a material keeps its one depth material');
}

// ---------------------------------------------------------------- 5. wrapping again

{
  const m = a.card;
  const hook = m.onBeforeCompile;
  const key = m.customProgramCacheKey();
  swayWrap(m);
  swayWrap(m);
  ok(m.onBeforeCompile === hook && m.customProgramCacheKey() === key, 'wrapping twice adds nothing');
  // The cascades replace the hook when they set up again: the chain starts afresh and the key with it.
  chained(m, true);
  ok(m.onBeforeCompile !== hook && m.customProgramCacheKey() === key && count(compiled(m, THREE.ShaderLib.physical).vertexShader, SWAY_APPLY) === 1, 'a hook the cascades replaced is wrapped again, with the same program key and the chunk once');
}

// ---------------------------------------------------------------- 6. no name twice

{
  const base = ['USE_MAP', 'USE_ALPHATEST', 'STANDARD'];
  const extras = [[], ['USE_INSTANCING'], ['SWG_WET'], ['SWG_CARD_LIGHT'], ['USE_INSTANCING', 'SWG_CARD_LIGHT', 'SWG_LEAF_SHADOW'], ['USE_INSTANCING', 'SWG_WET', 'SWG_CARD_LIGHT', 'SWG_LEAF_SHADOW', 'USE_SHADOWMAP']];
  const colour = compiled(a.card, THREE.ShaderLib.physical);
  const depth = compiled(swayDepthFor(a.card), THREE.ShaderLib.depth);
  ok(redeclared(`void f() { ${SWAY_APPLY} ${SWAY_APPLY.replace('mat4 swgSwayModel = modelMatrix;', 'mat4 swgSwayModel = modelMatrix; mat4 swgSwayModel = modelMatrix;')} }`).includes('f: swgSwayModel'), 'the scope scan finds a name declared twice when one is planted in the chunk');
  const twice = extras.flatMap((e) => {
    const d = new Set([...base, ...e]);
    return [...redeclared(glslVariant(resolve(colour.vertexShader), d)).map((t) => `colour ${[...e].join('+') || 'plain'}: ${t}`), ...redeclared(glslVariant(resolve(depth.vertexShader), d)).map((t) => `depth ${[...e].join('+') || 'plain'}: ${t}`)];
  });
  ok(twice.length === 0, `no name is declared twice in one scope, in the colour or the depth program, in any variant${twice.length ? `: ${twice.slice(0, 4).join(', ')}` : ''}`);
}

// ---------------------------------------------------------------- 7. the warm list

{
  const meshes: THREE.Mesh[] = [];
  for (const t of [a, b]) {
    const im = new THREE.InstancedMesh(t.cardMesh.geometry, t.card, 4);
    const it = new THREE.InstancedMesh(t.trunkMesh.geometry, t.trunk, 4);
    meshes.push(im, it, t.cardMesh, t.trunkMesh);
  }
  const standIns = swayDepthStandIns(meshes);
  const instanced = standIns.filter((s) => (s as THREE.InstancedMesh).isInstancedMesh).length;
  ok(standIns.length === 4 && instanced === 2, `one stand-in per depth combination: two models of a card and a trunk, drawn instanced and plain, come to ${standIns.length} (${instanced} instanced)`);
  ok(standIns.every((s) => s.castShadow && !!s.customDepthMaterial && s.customDepthMaterial.customProgramCacheKey() === 'swg-sway-depth' && (s.customDepthMaterial as THREE.MeshDepthMaterial).isMeshDepthMaterial && (s.material as THREE.Material).userData.swgSway !== undefined), "each casts, wears its source's own material (which three copies the side, the cut and the picture from) and hangs a sway depth material");
  const card = standIns.find((s) => (s.customDepthMaterial as THREE.MeshDepthMaterial).alphaTest > 0)!;
  const cd = card.customDepthMaterial as THREE.MeshDepthMaterial;
  ok(cd.side === THREE.DoubleSide && !!cd.map, "the card's depth material is set up as a shadow draw sets it (both sides, cut, its map), so a compile of it alone builds the draw's program");
  // A second light set is warmed through depth materials of its own: three keeps an unlit material's first program.
  const rooms = swayDepthStandIns(meshes, 'rooms');
  const again = swayDepthStandIns(meshes, 'rooms');
  ok(rooms.length === standIns.length && rooms.every((s, i) => s.customDepthMaterial !== standIns[i].customDepthMaterial && s.customDepthMaterial!.customProgramCacheKey() === 'swg-sway-depth' && s.customDepthMaterial === again[i].customDepthMaterial), "a second light set's stand-ins hang depth materials of their own, of the same program key, kept for the session");
  for (const s of [...standIns, ...rooms, ...again]) disposeStandIn(s);
}

(THREE.ShaderChunk as unknown as Record<string, string>).lights_fragment_begin = keepChunk;
console.log(`\nswayShader: ${passed} checks passed`);
