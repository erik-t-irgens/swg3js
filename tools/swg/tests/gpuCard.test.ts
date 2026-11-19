// The GPU port's step 4, item 4, in node: the leaf cards' node graph on WebGPU (`gpuCard.ts`), held to its structure, since
// node draws nothing (the browser's `__debug.cardLightSelfTest()` and `__debug.leafShadowSelfTest()` on WebGPU hold the pixels).
//
//  1. every knob is a uniform of the shared render group reading the very uniform object the WebGL injection reads
//     (`CARD_LIGHT_UNIFORMS`, `CARD_UNIFORMS`), the card light's switch also the room pass's and the console's look switch;
//  2. each card's own numbers are object uniforms read off the records the WebGL injection hands its program
//     (`cardUniformsOf`, `cardLightUniformsOf`, by identity) and its defines;
//  3. the arithmetic's graphs hold the mirror's own numbers (`cardLightMath.ts`, `leafShadow.ts`) and none of their own;
//  4. the acne floor is a shader-local variable every cascade's bias node multiplies by one plus, assigned by cards alone;
//  5. the part goes on a copy exactly where the card rule's wrap went on, after the highlight's, and changes the copy's
//     position, colour, lighting model and lighting where three builds them, keeping the model's own instance;
//  6. the sun's shadow: a light that is not the sun keeps three's own shadowed colour, the sun's is the cascades' factor.
//
// Run: node tools/swg/tests/gpuCard.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { MeshStandardNodeMaterial, PhysicalLightingModel } from 'three/webgpu';
import { vec3, float } from 'three/tsl';
import { CARD_LIGHT_UNIFORMS, cardLightUniformsOf } from '../../../src/world/cardLight.ts';
import { CARD_HOOK, CARD_UNIFORMS, applyCard, cardUniformsOf, prepareCardModel } from '../../../src/world/cardRule.ts';
import { ACES_FIT, ACES_IN_INV, ACES_OUT_INV, CARD_FLOORS, LUMINANCE, SRGB_CURVE } from '../../../src/world/cardLightMath.ts';
import { CROWN_DIR_FLOOR } from '../../../src/world/leafShadow.ts';
import { applySpec } from '../../../src/world/specular.ts';
import { chainHas } from '../../../src/world/compileHooks.ts';
import { GPU_LOOKS, LOOK_PARTS, installLooks } from '../../../src/core/gpu/looks.ts';
import { ClientLightingModel, specPart } from '../../../src/core/gpu/gpuSpec.ts';
import { detailPart } from '../../../src/core/gpu/gpuDetail.ts';
import { CARD_GRAPH_NUMBERS, LEAF_FLOOR, acesInverseNode, cardKnobs, cardPart, cardPerObject, clientCurveNode, clientLightNode, crownSkipNode, isGpuSun, leafBiasNode, toLinearNode, toSrgbNode } from '../../../src/core/gpu/gpuCard.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
let checks = 0;
const ok = (cond: unknown, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
  console.log(`ok   ${msg}`);
};
const read = (f: string): string => readFileSync(new URL(`../../../${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

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
/** Every number the graph's constants hold: plain numbers, and each component of a constant vector or matrix (`vec3(k)`, `mat3(...)`). */
const constsOf = (root: Any): number[] =>
  graph(root)
    .filter((n) => n.isConstNode)
    .flatMap((n) => {
      const v = n.value;
      if (typeof v === 'number') return [v];
      if (v?.isVector2) return [v.x, v.y];
      if (v?.isVector3) return [v.x, v.y, v.z];
      if (v?.isVector4) return [v.x, v.y, v.z, v.w];
      if (v?.isColor) return [v.r, v.g, v.b];
      if (v?.isMatrix3 || v?.isMatrix4) return [...v.elements];
      return [];
    });
const uniformsOf = (root: Any): Set<Any> => new Set(graph(root).filter((n) => n.isUniformNode));

/** A card material as a model load makes one, ruled and wrapped (the WebGL self-test's own way). */
function card(blend = false): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ map: new THREE.DataTexture(new Uint8Array([60, 90, 40, 255]), 1, 1), roughness: 1, metalness: 0, alphaTest: 0.5, side: THREE.DoubleSide });
  mat.name = 'test card';
  mat.userData.swgCard = { blend, emissive: [0.1, 0.2, 0.3] };
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  prepareCardModel([g], { flora: true, count: false });
  applyCard(mat);
  return mat;
}

// ---------------------------------------------------------------- 1. the knobs
{
  const k = cardKnobs();
  const L = CARD_LIGHT_UNIFORMS as Record<string, { value: unknown }>;
  const R = CARD_UNIFORMS as Record<string, { value: unknown }>;
  const pairs: [string, Record<string, { value: unknown }>, string][] = [
    ['curve', L, 'uSwgCardCurve'], ['front', L, 'uSwgCardFront'], ['tangent', L, 'uSwgCardTangent'], ['back', L, 'uSwgCardBack'],
    ['ambient', L, 'uSwgCardAmbient'], ['fill', L, 'uSwgCardFill'], ['bounce', L, 'uSwgCardBounce'], ['row7', L, 'uSwgCardRow7'],
    ['row7Alpha', L, 'uSwgCardRow7Alpha'], ['fillDir', L, 'uSwgCardFillDir'], ['bounceDir', L, 'uSwgCardBounceDir'], ['fills', L, 'uSwgCardFills'],
    ['emissiveOn', L, 'uSwgCardEmissiveOn'], ['gain', L, 'uSwgCardGain'], ['exposureRef', L, 'uSwgCardExposureRef'], ['bloomCap', L, 'uSwgCardBloomCap'],
    ['shadowLook', L, 'uSwgCardShadowLook'], ['sunSide', L, 'uSwgCardSunSide'], ['pointFlat', L, 'uSwgCardPointFlat'], ['leafSun', L, 'uSwgLeafSun'],
    ['leafSelf', L, 'uSwgLeafSelf'], ['leafShare', L, 'uSwgLeafShare'], ['leafAcne', L, 'uSwgLeafAcne'],
    ['cutPunch', R, 'uSwgCardCutPunch'], ['cutBlend', R, 'uSwgCardCutBlend'], ['mipScale', R, 'uSwgCardMipScale'], ['mipScalePunch', R, 'uSwgCardMipScalePunch'], ['backsStored', R, 'uSwgCardBacksStored'],
  ];
  for (const [name, src, key] of pairs) {
    const node = (k as Any)[name];
    const u = src[key];
    const was = u.value;
    if (typeof was === 'number') {
      u.value = 0.371;
      node.update({});
      ok(node.isUniformNode && node.groupNode?.name === 'render' && node.value === 0.371, `the ${name} knob is a render-group uniform reading ${key}'s own object once a render`);
      u.value = was;
    } else {
      node.update({});
      ok(node.isUniformNode && node.groupNode?.name === 'render' && node.value === was, `the ${name} knob is a render-group uniform reading ${key}'s own vector, by reference`);
    }
    node.update({});
  }
  ok(cardKnobs() === k, 'the knobs are made once and shared by every card');
  const on = CARD_LIGHT_UNIFORMS.uSwgCardOn.value;
  const look = GPU_LOOKS.card;
  CARD_LIGHT_UNIFORMS.uSwgCardOn.value = 1;
  GPU_LOOKS.card = true;
  k.on.update({});
  const both = k.on.value;
  CARD_LIGHT_UNIFORMS.uSwgCardOn.value = 0;
  k.on.update({});
  const room = k.on.value;
  CARD_LIGHT_UNIFORMS.uSwgCardOn.value = 1;
  GPU_LOOKS.card = false;
  k.on.update({});
  k.look.update({});
  const off = k.on.value;
  ok(both === 1 && room === 0 && off === 0 && k.look.value === 0 && k.on.groupNode?.name === 'render', "the card light's switch is uSwgCardOn (the rooms pass puts it out) and the console's look switch, read once a render; the look switch alone the rule's");
  CARD_LIGHT_UNIFORMS.uSwgCardOn.value = on;
  GPU_LOOKS.card = look;
  k.on.update({});
  k.look.update({});
}

// ---------------------------------------------------------------- 2. each card's own
{
  const o = cardPerObject();
  const m = card(true);
  for (const key of ['light', 'leaf', 'blend', 'emissive', 'boxMin', 'boxMax', 'mapSize', 'mapMatrix'] as const) (o as Any)[key].update({ material: m });
  const lu = cardLightUniformsOf(m);
  ok(o.blend.value === cardUniformsOf(m).swgCardBlend.value && o.blend.value === 1, "a card's class is read off the record the WebGL injection hands its program");
  ok(o.emissive.value === lu.swgCardEmissive.value && o.boxMin.value === lu.swgLeafBoxMin.value && o.boxMax.value === lu.swgLeafBoxMax.value, 'its emissive and its crown, the very vectors');
  ok(o.light.value === 1 && o.leaf.value === 1, 'and its two defines (the card light, the skip), which are not in the program key, as uniforms');
  ok(o.mapSize.value.x === 1 && o.mapSize.value.y === 1 && o.mapMatrix.value === m.map!.matrix, "the picture's size at its top level and its own uv matrix, for the mip level");
  for (const key of ['light', 'leaf', 'blend', 'emissive', 'boxMin', 'boxMax', 'mapSize', 'mapMatrix'] as const) ok((o as Any)[key].updateType === 'object' && (o as Any)[key].groupNode?.name === 'object', `the ${key} is an object uniform, written once an object`);
  const inside = new THREE.MeshStandardMaterial();
  inside.userData.interior = true;
  o.light.update({ material: inside });
  ok(o.light.value === 0, "a material with no card light define (a building's own cells) reads nought, so three lights it");
  o.light.update({ material: m });
}

// ---------------------------------------------------------------- 3. the mirror's numbers
{
  ok(CARD_GRAPH_NUMBERS.aces === ACES_FIT && CARD_GRAPH_NUMBERS.srgb === SRGB_CURVE && CARD_GRAPH_NUMBERS.luminance === LUMINANCE && CARD_GRAPH_NUMBERS.floors === CARD_FLOORS && CARD_GRAPH_NUMBERS.crown === CROWN_DIR_FLOOR && CARD_GRAPH_NUMBERS.inIn === ACES_IN_INV && CARD_GRAPH_NUMBERS.outIn === ACES_OUT_INV, "the graph's numbers are the mirrors' own objects");
  const flat = (m: readonly (readonly number[])[]): number[] => m.flatMap((r) => [...r]);
  const aces = constsOf(acesInverseNode(vec3(0.5)));
  for (const v of [...Object.values(ACES_FIT), ...flat(ACES_IN_INV), ...flat(ACES_OUT_INV)]) ok(aces.includes(v), `the fit carried back holds the mirror's ${v}`);
  // TSL's mat3 of nine numbers is three's Matrix3.set, row by row, kept by columns: the constants must be the mirror's rows
  // (handed the GLSL text's column order they were the transpose, which turned every hue in the browser self-test).
  const mats = graph(acesInverseNode(vec3(0.5))).filter((n) => n.isConstNode && n.value?.isMatrix3).map((n) => n.value.elements as number[]);
  const cols = (m: readonly (readonly number[])[]): number[] => [m[0][0], m[1][0], m[2][0], m[0][1], m[1][1], m[2][1], m[0][2], m[1][2], m[2][2]];
  ok(mats.length === 2 && mats.some((e) => e.every((v, i) => v === cols(ACES_OUT_INV)[i])) && mats.some((e) => e.every((v, i) => v === cols(ACES_IN_INV)[i])), 'the two matrices are the mirror\'s, row for row (three keeps them by columns, as the shader reads them)');
  const allowAces = new Set<number>([...Object.values(ACES_FIT), ...flat(ACES_IN_INV), ...flat(ACES_OUT_INV), 0, 1, 2, 4, 0.5]);
  const strayAces = aces.filter((c) => !allowAces.has(c));
  ok(strayAces.length === 0, `and no number of its own beside them but nought, one, two, four (the quadratic's) and the test's own half (${strayAces.join(', ')})`);
  const s = constsOf(toSrgbNode(vec3(0.5)));
  const l = constsOf(toLinearNode(vec3(0.5)));
  for (const key of ['toSrgbBelow', 'toSrgbLine', 'toSrgbScale', 'toSrgbPower', 'toSrgbOffset'] as const) ok(s.includes(SRGB_CURVE[key]), `the sRGB curve holds the mirror's ${key}`);
  for (const key of ['toLinearBelow', 'toLinearLine', 'toLinearScale', 'toLinearOffset', 'toLinearPower'] as const) ok(l.includes(SRGB_CURVE[key]), `the linear curve holds the mirror's ${key}`);
  const curve = clientCurveNode(vec3(0.3), vec3(0.6), float(1));
  const cc = constsOf(curve);
  for (const v of LUMINANCE) ok(cc.includes(v), `the bloom cap's luminance holds the mirror's ${v}`);
  ok(cc.includes(CARD_FLOORS.exposure), "the exposure's floor is the mirror's");
  const allowCurve = new Set<number>([...Object.values(ACES_FIT), ...flat(ACES_IN_INV), ...flat(ACES_OUT_INV), ...Object.values(SRGB_CURVE), ...LUMINANCE, CARD_FLOORS.exposure, 0, 1, 2, 4, 0.5, 0.3, 0.6]);
  const strayCurve = cc.filter((c) => !allowCurve.has(c));
  ok(strayCurve.length === 0, `the 'client' curve has no number of its own (${strayCurve.join(', ')})`);
  const k = cardKnobs();
  const curveUs = uniformsOf(curve);
  for (const name of ['shadowLook', 'row7', 'row7Alpha', 'exposureRef', 'bloomCap'] as const) ok(curveUs.has(k[name]), `the curve reads the ${name} knob by reference`);
  const g = clientLightNode(vec3(0, 0, 1), vec3(0, 0, 1), float(1), vec3(0));
  const gUs = uniformsOf(g);
  for (const name of ['front', 'tangent', 'back', 'ambient', 'fill', 'bounce', 'fillDir', 'bounceDir', 'fills', 'emissiveOn', 'gain', 'shadowLook'] as const) ok(gUs.has(k[name]), `the client's sum reads the ${name} knob by reference`);
  const gc = constsOf(g).filter((c) => ![0, 1, -1, 0.5, 1.5].includes(c));
  ok(gc.length === 0, `the client's sum has no number but its thresholds (${gc.join(', ')})`);
  const skip = crownSkipNode(vec3(0), vec3(0, 1, 0), float(1), vec3(-1), vec3(1));
  const sc = constsOf(skip);
  ok(sc.includes(CROWN_DIR_FLOOR) && sc.includes(-CROWN_DIR_FLOOR) && sc.filter((c) => ![0, 1, -1, CROWN_DIR_FLOOR, -CROWN_DIR_FLOOR].includes(c)).length === 0, "the crown's exit holds leafShadow's floor either way and nothing of its own");
}

// ---------------------------------------------------------------- 4. the acne floor
{
  const ref = float(0.25);
  const bias = leafBiasNode(ref);
  const ns = graph(bias);
  ok(ns.includes(LEAF_FLOOR) && ns.includes(ref), "a cascade's bias node is its own bias times one plus the leaf floor");
  ok(LEAF_FLOOR.isPropertyNode === true && LEAF_FLOOR.name === 'swgLeafFloor', "the leaf floor is a shader-local variable (zero in WGSL wherever no card assigns it)");
  const sun = read('src/core/gpu/sun.ts');
  ok(/l\.shadow\.biasNode = leafBiasNode\(reference\('bias', 'float', l\.shadow\)\.setGroup\(renderGroup\)\);/.test(sun), "sun.ts: each cascade's bias node reads that cascade's own bias, as three's would");
  const src = read('src/core/gpu/gpuCard.ts');
  ok(/LEAF_FLOOR\.assign\(select\(leafOn, k\.leafAcne\.mul\(k\.leafSelf\)\.mul\(2\), float\(0\)\)\);/.test(src), "a card assigns it 2 × acne × self (the WebGL bias × (1 + 2 × acne × self)) where it takes the skip, nought otherwise");
}

// ---------------------------------------------------------------- 5. where the part goes and what it changes
{
  const m = card();
  const plain = new THREE.MeshStandardMaterial({ alphaTest: 0.5 });
  ok(chainHas(m.onBeforeCompile, CARD_HOOK) && cardPart.applies(m) && !cardPart.applies(plain) && !cardPart.applies(new THREE.MeshBasicMaterial()), "the part goes on a material the card rule's wrap went on and nowhere else");
  ok(m.customProgramCacheKey().includes('card'), "which is exactly where the program key says 'card'");
  const start = read('src/core/gpu/start.ts');
  ok(/LOOK_PARTS\.push\(lightHoldPart, detailPart, specPart, cardPart\);/.test(start), "start.ts: the card part goes on after the highlight's, whose model it changes (and after the held indirect light, pass 1's wave 2, which both build on)");
  const copy: Any = new MeshStandardNodeMaterial();
  for (const key in m) copy[key] = (m as Any)[key];
  const own = { position: copy.setupPosition, diffuse: copy.setupDiffuseColor, model: copy.setupLightingModel, lighting: copy.setupLighting };
  cardPart.apply(copy, m);
  ok(copy.setupPosition !== own.position && copy.setupDiffuseColor !== own.diffuse && copy.setupLightingModel !== own.model && copy.setupLighting !== own.lighting, "the copy's position, colour, lighting model and lighting are the card's");
  const model = copy.setupLightingModel({ material: m, object: new THREE.Mesh(), geometry: new THREE.PlaneGeometry() });
  ok(model instanceof (PhysicalLightingModel as Any) && Object.hasOwn(model, 'direct') && Object.hasOwn(model, 'indirect') && Object.hasOwn(model, 'start'), "three's own model instance, its direct, indirect and start changed on the instance alone");
  ok(!Object.hasOwn(PhysicalLightingModel.prototype, 'swgCard') && (PhysicalLightingModel.prototype as Any).direct !== model.direct, "and three's prototype is left as it was");
  // A card with the highlight's wrap too: its copy's model is the client's highlight's, changed by the card.
  const both = card();
  both.userData.swgSpec = { mode: 'none', color: [0, 0, 0], power: 0 };
  applySpec(both, false);
  const copy2: Any = new MeshStandardNodeMaterial();
  for (const key in both) copy2[key] = (both as Any)[key];
  for (const p of [detailPart, specPart, cardPart]) if (p.applies(both)) p.apply(copy2, both);
  const model2 = copy2.setupLightingModel({ material: both, object: new THREE.Mesh(), geometry: new THREE.PlaneGeometry() });
  ok(model2 instanceof ClientLightingModel && Object.hasOwn(model2, 'direct'), "a card with the highlight's wrap keeps the client's highlight, the card's changes on that instance");
  // The fresh copies three makes meet the card part through the library's one place.
  const lib = { fromMaterial: (mat: Any) => { const c: Any = new MeshStandardNodeMaterial(); for (const key in mat) c[key] = mat[key]; return c; } };
  LOOK_PARTS.length = 0;
  LOOK_PARTS.push(detailPart, specPart, cardPart);
  installLooks({ library: lib });
  const made = lib.fromMaterial(card());
  ok(made.setupLighting !== MeshStandardNodeMaterial.prototype.setupLighting, 'a fresh copy of a card made by the library carries the part');
  LOOK_PARTS.length = 0;
  const src = read('src/core/gpu/gpuCard.ts');
  ok(/return out && pending \? context\(out, pending\) : out;/.test(src), "the lighting is built inside a context of the card's own (the sun's shadow and the lookup's place)");
  ok(/if \(light\?\.isDirectionalLight === true\) \{[\s\S]*?return ownDirect\.call\(this, \{ \.\.\.input, lightColor: select\(cardOn, vec3\(0\), input\.lightColor\) \}, bld\);/.test(src), 'every directional light is put out while the card light is on (the sun and the fill are in the sum)');
  ok(/this\.indirectDiffuse\(bld\);\s*this\.indirectSpecular\(bld\);[\s\S]*?this\.ambientOcclusion\(bld\);/.test(src), "the sum goes in after three's indirect light and before its occlusion, where the WebGL text puts it (after lights_fragment_end, before the ao map)");
  ok(/reflectedLight\.indirectDiffuse\.assign\(\(BRDF_Lambert as Any\)\(\{ diffuseColor: diffuseContribution \}\)\.mul\(ambient\)\);/.test(src), "the card's indirect light is three's ambient alone (no hemisphere)");
}

// ---------------------------------------------------------------- 6. the sun's shadow
{
  const sunLight = new THREE.DirectionalLight();
  sunLight.userData.swgSun = true;
  ok(isGpuSun(sunLight) && !isGpuSun(new THREE.DirectionalLight()) && !isGpuSun(null), 'the sun is the one light sun.ts marks');
  const src = read('src/core/gpu/gpuCard.ts');
  ok(/if \(!isGpuSun\(lightNode\?\.light\) \|\| !lightNode\.shadowNode\) return lightNode\.shadowColorNode;/.test(src), "a light that is not the sun keeps three's own shadowed colour");
  ok(/sunShadow\.assign\(mix\(float\(1\), s, select\(leafOn, k\.leafShare, float\(1\)\)\)\);\s*return vec3\(lightNode\.baseColorNode\)\.mul\(sunShadow\);/.test(src), "the sun's is its unshadowed colour times the cascades' own factor, mixed toward one by the leaf's share (1 − k(1 − s), which is the WebGL lookups' intensity × share through the fade, exactly)");
  ok(/const shadowPositionWorld = positionWorld\.add\(k\.leafSun\.mul\(select\(leafOn, skip\.mul\(k\.leafSelf\), float\(0\)\)\)\);/.test(src), "the skip moves the lookup's place toward the sun by its metres (an orthographic cascade's depth lowered by those metres over its own range, the WebGL bias's skip)");
  const sun = read('src/core/gpu/sun.ts');
  ok(/light\.userData\.swgSun = true;/.test(sun), 'sun.ts marks the light of the cascades as the sun');
  // The leaf self-test's fourth part draws the same three cases through three's cascades, as the game's sun is drawn: a
  // CSMShadowNode with its fade, each cascade carrying the leaf floor's bias node, a negative bias and a normal bias.
  const test = read('src/core/gpu/gpuCardSelfTest.ts');
  ok(test.includes("const node: Any = new CSMShadowNode(sunC, { cascades: 3, maxFar: CASCADE_STAGE.maxFar, mode: 'practical', lightMargin: CASCADE_STAGE.lightMargin });") && test.includes('node.fade = true;') && test.includes("for (const l of node.lights as { shadow: Any }[]) l.shadow.biasNode = leafBiasNode(reference('bias', 'float', l.shadow).setGroup(renderGroup));") && /const ok = !failed && plainOk && cascadesOk;/.test(test), "the leaf self-test holds the skip through the cascades' own node too, and passes only where both stages pass");
  ok(test.includes('o.userData.swgSelfTest = true;'), "and its stages' pipelines are counted apart, never as made in play");
}

console.log(`gpuCard: ${checks} checks passed`);
