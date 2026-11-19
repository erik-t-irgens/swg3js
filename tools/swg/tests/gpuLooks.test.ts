// The GPU port's step 4, in node: the node graphs the models' own looks build on WebGPU, held to their structure, since
// node draws nothing (the browser's `__debug.specSelfTest()` on WebGPU holds the pixels).
//
//  1. the client's highlight (`gpuSpec.ts`): its knobs are three's uniforms in the shared render group, each reading the
//     very uniform object the WebGL injection reads (`SPEC_UNIFORMS`); each material's mode, colour and power are object
//     uniforms reading the very record the WebGL injection hands its program (`specUniformsOf`), the colour by identity;
//     the term's graph holds the mirror's own numbers (`specMath.ts`) and no other of its own, the ones the WebGL shader
//     text writes; the film's graph reads the switch, the console's look switch and the film knob; the part goes on a
//     copy exactly where the wrap's key does (the hook chain), its model is three's physical one with the same features
//     and its mask is the red of the very node three's roughness reads its green from;
//  2. reflections (`gpuEnv.ts`): three's own environment node reads a registered material's `envMap` once an object, so the
//     registry's texture (the stand-in, then the capture) reaches the draw by its rules; the world's WebGPU half is held as
//     text to the rules it shares with WebGL's (the kept dome, the kept target never freed, the 'game' source's own target);
//  3. the detail map (`gpuDetail.ts`): the part goes on a copy exactly where the detail wrap's key does, its colour is the
//     material's own times the detail texture at the second coordinate set behind the look switch, the texture is the one
//     `detailWrap` hands the WebGL injection, read once an object, and a geometry with no second set keeps three's colour;
//  4. the parts meet a fresh copy of a classic material in order and never a stand-in or a node material;
//  5. step 3's stand-ins read every colour and dial in the shared render group (the sky's capture never moves its dome).
//
// Run: node tools/swg/tests/gpuLooks.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { MaterialNode, MeshPhysicalNodeMaterial, MeshStandardNodeMaterial, PhysicalLightingModel } from 'three/webgpu';
import { normalView, positionViewDirection, vec3 } from 'three/tsl';
import { SPEC_PARS, SPEC_UNIFORMS, applySpec, specUniformsOf } from '../../../src/world/specular.ts';
import { BAND_POWER, BAND_TIGHTEN, GATE_NL, MODE_BAND_ABOVE, MODE_NONE_BELOW, SPEC_FLOOR } from '../../../src/world/specMath.ts';
import { applyDetail } from '../../../src/world/detailMap.ts';
import { surfaces } from '../../../src/world/surfaces.ts';
import { currentEnvironment, registerReflective, setEnvironment, setEnvironmentStandIn } from '../../../src/world/envmap.ts';
import { GPU_LOOKS, LOOKS_AT_LOAD, LOOK_STATS, installLooks, type LookPart } from '../../../src/core/gpu/looks.ts';
import { ClientLightingModel, SPEC_GRAPH_NUMBERS, clientSpecularNode, diffuseBackNode, filmNode, maskFor, specKnobs, specPart, specPerMaterial, specSelfTestRefusal } from '../../../src/core/gpu/gpuSpec.ts';
import { DetailTextureNode, detailPart, detailSwitch, detailTextureOf } from '../../../src/core/gpu/gpuDetail.ts';
import { makeStandIns } from '../../../src/core/gpu/standIns.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
let checks = 0;
const ok = (cond: unknown, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
  console.log(`ok   ${msg}`);
};
const read = (f: string): string => readFileSync(new URL(`../../../${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

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
const constsOf = (root: Any): number[] => graph(root).filter((n) => n.isConstNode && typeof n.value === 'number').map((n) => n.value as number);
const uniformsOf = (root: Any): Set<Any> => new Set(graph(root).filter((n) => n.isUniformNode));

/** Three's own copy of a classic material, made the way its node library makes it. */
function copyOf(m: THREE.Material): Any {
  const C: Any = (m as Any).isMeshPhysicalMaterial ? MeshPhysicalNodeMaterial : MeshStandardNodeMaterial;
  const node = new C();
  for (const key in m) node[key] = (m as Any)[key];
  return node;
}
function wrapped(spec = { mode: 'phong', color: [0.5, 0.25, 0.125], power: 20 }, map: THREE.Texture | null = null): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.5 });
  if (map) {
    m.roughnessMap = map;
    m.metalnessMap = map;
  }
  m.userData.swgSpec = spec;
  applySpec(m, false);
  return m;
}

// ---------------------------------------------------------------- 1. the client's highlight
{
  const k = specKnobs();
  const pairs: [Any, THREE.IUniform<number>, string][] = [
    [k.use, SPEC_UNIFORMS.uSwgSpecUse, 'use'],
    [k.gain, SPEC_UNIFORMS.uSwgSpecGain, 'gain'],
    [k.cap, SPEC_UNIFORMS.uSwgSpecCap, 'cap'],
    [k.film, SPEC_UNIFORMS.uSwgSpecFilm, 'film'],
    [k.gate, SPEC_UNIFORMS.uSwgSpecGate, 'gate'],
  ];
  for (const [node, u, name] of pairs) {
    const was = u.value;
    u.value = 0.371;
    node.update({});
    ok(node.isUniformNode && node.groupNode?.name === 'render' && node.value === 0.371, `the ${name} knob is a uniform of the shared render group reading SPEC_UNIFORMS' own object once a render`);
    u.value = was;
    node.update({});
  }
  ok(specKnobs() === k, 'the knobs are made once and shared by every model');
  const was = GPU_LOOKS.spec;
  GPU_LOOKS.spec = false;
  k.on.update({});
  ok(k.on.value === 0 && k.on.groupNode?.name === 'render', "the console's look switch is a render-group uniform reading GPU_LOOKS.spec");
  GPU_LOOKS.spec = was;
  k.on.update({});

  const m = wrapped();
  const p = specPerMaterial();
  for (const key of ['mode', 'color', 'power'] as const) p[key].update({ material: m });
  const u = specUniformsOf(m);
  ok(p.mode.value === u.swgSpecMode.value && p.power.value === u.swgSpecPower.value && p.color.value === u.swgSpecColor.value, "each material's mode, power and colour are read off the record the WebGL injection hands its program (the colour the very vector)");
  ok(p.mode.groupNode?.name === 'object' && p.mode.updateType === 'object' && p.color.updateType === 'object' && p.power.updateType === 'object', 'and they are object uniforms, written once an object');
  const other = wrapped({ mode: 'aniso', color: [1, 1, 1], power: 7 });
  p.power.update({ material: other });
  ok(p.power.value === 7 && specUniformsOf(other).swgSpecMode.value === 2, 'another material drawn through the same graph gives its own numbers');

  // The term's numbers: the mirror's own, and the ones the WebGL shader writes.
  ok(SPEC_GRAPH_NUMBERS.tighten === BAND_TIGHTEN && SPEC_GRAPH_NUMBERS.bandPower === BAND_POWER && SPEC_GRAPH_NUMBERS.floor === SPEC_FLOOR && SPEC_GRAPH_NUMBERS.gateNl === GATE_NL && SPEC_GRAPH_NUMBERS.noneBelow === MODE_NONE_BELOW && SPEC_GRAPH_NUMBERS.bandAbove === MODE_BAND_ABOVE, "the graph's numbers are specMath's");
  ok(/const float SWG_BAND_TIGHTEN = 1\.25;/.test(SPEC_PARS) && /const float SWG_BAND_POWER = 0\.15;/.test(SPEC_PARS) && /1e-6/.test(SPEC_PARS) && /step\( 1e-4, swgNL \)/.test(SPEC_PARS) && /swgSpecMode < 0\.5/.test(SPEC_PARS) && /swgSpecMode > 1\.5/.test(SPEC_PARS), 'and the very numbers the WebGL shader text writes');
  const mask = vec3(1).x;
  const term = clientSpecularNode(vec3(1, 1, 1), vec3(0, 0, 1), normalView, positionViewDirection, mask);
  const consts = constsOf(term);
  for (const [name, v] of Object.entries(SPEC_GRAPH_NUMBERS)) ok(consts.includes(v), `the term's graph holds the mirror's ${name} (${v})`);
  // Pi as specMath divides by it (a white surface facing the light is the light over pi), nought and one.
  const allowed = new Set<number>([...Object.values(SPEC_GRAPH_NUMBERS), 0, 1, Math.PI]);
  const stray = consts.filter((c) => !allowed.has(c));
  ok(stray.length === 0, `and no number of its own beside them, pi, nought and one (${stray.join(', ')})`);
  const us = uniformsOf(term);
  ok(us.has(p.mode) && us.has(p.color) && us.has(p.power) && us.has(k.gain) && us.has(k.cap) && us.has(k.gate), "the term reads the material's three and the gain, cap and gate knobs, by reference");
  ok(!us.has(k.use) && !us.has(k.film) && !us.has(k.on), 'and not the switch, the film or the look switch, which are the film\'s');
  const film = uniformsOf(filmNode());
  ok(film.has(k.use) && film.has(k.on) && film.has(k.film), "the film reads the switch, the console's look switch and the film knob");

  // Where the part goes on: exactly where the wrap's key does.
  const plain = new THREE.MeshStandardMaterial();
  plain.userData.swgSpec = { mode: 'phong', color: [1, 1, 1], power: 20 };
  ok(specPart.applies(m) && !specPart.applies(plain) && !specPart.applies(new THREE.MeshBasicMaterial()), "the part goes on a material the highlight's wrap went on and nowhere else (a material that names a highlight but was never wrapped keeps three's)");
  ok(m.customProgramCacheKey().startsWith('spec|') && !plain.customProgramCacheKey().includes('spec'), "which is exactly where the program key says 'spec'");

  // The model: three's physical one, the same features, its mask the red of three's own roughness texture node.
  const map = new THREE.DataTexture(new Uint8Array([128, 255, 0, 255]), 1, 1);
  const masked = wrapped(undefined, map);
  const copy = copyOf(masked);
  specPart.apply(copy, masked);
  const model = copy.setupLightingModel({ material: masked });
  ok(model instanceof ClientLightingModel && model instanceof (PhysicalLightingModel as Any), 'a wrapped copy is lit by our model, which is three\'s physical one');
  const cached = (new (MaterialNode as Any)(MaterialNode.ROUGHNESS) as Any).getTexture('roughness');
  ok(model.mask.isSplitNode && model.mask.node === cached && /^[rx]$/.test(model.mask.components), "its mask is the red of the very node three's roughness reads its green from");
  ok(maskFor(m).isConstNode && maskFor(m).value === 1, 'and one where there is no metal-rough picture');
  const glass = new THREE.MeshPhysicalMaterial({ clearcoat: 0.5 });
  glass.userData.swgSpec = { mode: 'phong', color: [10, 10, 10], power: 8 };
  applySpec(glass, false);
  const gcopy = copyOf(glass);
  specPart.apply(gcopy, glass);
  const gmodel = gcopy.setupLightingModel({ material: glass });
  ok(gmodel instanceof ClientLightingModel && gmodel.clearcoat === true, 'a physical material keeps the features three would have lit it with (its clearcoat)');
  ok(typeof (ClientLightingModel.prototype as Any).direct === 'function' && !Object.hasOwn(ClientLightingModel.prototype, 'indirect') && !Object.hasOwn(ClientLightingModel.prototype, 'start') && !Object.hasOwn(ClientLightingModel.prototype, 'indirectSpecular'), "the direct light and the ambient's diffuse are ours: the indirect's order, its highlight and the setup are three's");
  const gpuSpec = read('src/core/gpu/gpuSpec.ts');
  ok(/\(PhysicalLightingModel\.prototype as Any\)\.direct\.call\(this, \{ \.\.\.input, reflectedLight: \{ directDiffuse: reflectedLight\.directDiffuse, directSpecular: ggx \} \}, builder\);/.test(gpuSpec), "three's own direct light runs whole, its diffuse into the light's own and its specular caught apart");
  ok(/select\(film\.greaterThan\(0\), ggx\.mul\(film\), vec3\(0\)\)\.add\(select\(film\.lessThan\(1\), client\.mul\(float\(1\)\.sub\(film\)\), vec3\(0\)\)\)/.test(gpuSpec), "and the two are mixed as the WebGL line's two ifs mix them, so a film of one is three's to the bit");
  // The diffuse three cut for its own highlight, given back where the client's term stands (the WebGL picture's 0.185
  // diffuse, the `light-diffuse` hold): times one less the film, so a film of one (three's GGX) gives nothing back.
  ok(gpuSpec.includes('if (this.givesDiffuseBack) reflectedLight.directDiffuse.addAssign(diffuseBackNode(lightDirection, lightColor, normalView, film));'), "the client's model gives back the diffuse three cut for its highlight, by the very film it mixes the two highlights with");
  const back = uniformsOf(diffuseBackNode(vec3(0, 0, 1), vec3(1, 1, 1), normalView, filmNode()));
  ok(back.has(k.use) && back.has(k.on) && back.has(k.film), "and what it gives back is read through the film's switch, look switch and knob (nothing where three's GGX stands)");
  ok((model as Any).givesDiffuseBack === true && (gmodel as Any).givesDiffuseBack === true, 'a standard and a clearcoated material give it back (three cut theirs by the plain Fresnel alone)');
  // And the ambient's: three's own indirect diffuse first, then the share it took for its highlight's whole energy given
  // back by the same film (the WebGL picture's 0.185 ambient, the `ambient-diffuse` hold).
  // Three's indirect diffuse as 0.187 lit it (`HeldLightingModel`, pass 1's wave 2: the development commit reflects the ambient).
  ok(gpuSpec.includes('(HeldLightingModel.prototype as Any).indirectDiffuse.call(this, builder);') && gpuSpec.includes('const energy = self.singleScatteringDielectric.add(self.multiScatteringDielectric);') && gpuSpec.includes('reflectedLight.indirectDiffuse.addAssign(irradiance.mul((BRDF_Lambert as Any)({ diffuseColor: diffuseContribution })).mul(energy).mul(float(1).sub(filmNode())));'), "the client's model runs three's indirect diffuse whole and gives back the energy share by the film");
  const velvet = new THREE.MeshPhysicalMaterial({ sheen: 1 });
  velvet.userData.swgSpec = { mode: 'phong', color: [1, 1, 1], power: 8 };
  applySpec(velvet, false);
  const vcopy = copyOf(velvet);
  specPart.apply(vcopy, velvet);
  const vmodel = vcopy.setupLightingModel({ material: velvet });
  ok(vmodel instanceof ClientLightingModel && (vmodel as Any).givesDiffuseBack === false, "a sheen's model cuts its diffuse otherwise and keeps three's own");
  const card = read('src/core/gpu/gpuCard.ts');
  ok(card.includes('reflectedLight.directDiffuse.addAssign(lambert.mul(float(1).sub(F.mul(film))));') && card.includes('reflectedLight.directDiffuse.addAssign(lambert.mul(F.oneMinus()));'), "a leaf card's lamp gives the diffuse back the same way under the client's model, and keeps three's cut under three's");
  // The self-test refuses in words where it cannot run, rather than failing on a picture of three's own.
  ok(/left out at load/.test(specSelfTestRefusal(false, true) ?? '') && /wrap is skipped/.test(specSelfTestRefusal(true, false) ?? '') && specSelfTestRefusal(true, true) === null, 'the self-test says why it cannot run where its part is left out at load or the wrap skipped');
  const selfTest = read('src/core/gpu/gpuSpecSelfTest.ts');
  ok(selfTest.includes('mesh.userData.swgSelfTest = true;') && selfTest.includes('WARM_STATS.selfTestMade'), "and counts as built only its own sphere's pipelines, which the warm-up never counts as made in play");
}

// ---------------------------------------------------------------- 2. reflections
{
  // The registry's texture reaches three's own environment node by the material, once an object.
  const stand = new THREE.CubeTexture();
  (stand as Any).isPMREMTexture = true;
  setEnvironmentStandIn(stand);
  const m = new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.2 });
  m.userData.swgCube = true;
  registerReflective(m);
  ok(m.envMap === stand && currentEnvironment().texture === stand, 'a registered material carries the stand-in while the world has none');
  const copy = copyOf(m);
  const envNode = copy.setupEnvironment({ material: m, environmentNode: null });
  ok(envNode?.constructor?.name === 'EnvironmentNode' && envNode.isLightingNode === true && envNode.envNode?.isMaterialReferenceNode === true && envNode.envNode.property === 'envMap', "three's node copy lights it through an environment node reading the material's own envMap");
  ok(envNode._getEnvTexture({ material: m }) === stand, 'which reads the stand-in off the material three draws');
  const captured = new THREE.CubeTexture();
  (captured as Any).isPMREMTexture = true;
  setEnvironment(captured, 1);
  ok(m.envMap === captured && envNode._getEnvTexture({ material: m }) === captured, 'and the capture once the registry hands it over, with no new copy');
  const plain = new THREE.MeshStandardMaterial({ roughness: 0.2, envMapIntensity: 0.7 });
  plain.userData.swgCube = false;
  registerReflective(plain);
  ok(plain.envMap === captured && plain.envMapIntensity === 0, "a shader with no cube takes none, by the registry's own rule");
  setEnvironment(null);
  ok(m.envMap === stand, 'and the stand-in comes back when the world has none');
  setEnvironmentStandIn(null);

  const world = read('src/world/world.ts');
  const gpu = world.slice(world.indexOf('  private refreshEnvironmentGpu('), world.indexOf('  private useEnvironment('));
  ok(/const dome = \(this\.dome \?\?= env\.makeDome\(\)\);/.test(gpu) && /const captured = dome\.capture\(\(camera\) => camera\.update\(renderer, sky\.domeScene\)\);/.test(gpu) && /if \(captured\) this\.useEnvironment\(captured, null\);/.test(gpu), "the world's WebGPU half captures our sky through the kept dome, whose target is never handed over to be freed");
  ok(/const target = env\.filterCube\(tex\);/.test(gpu) && /this\.useEnvironment\(target\.texture, target as unknown as THREE\.WebGLRenderTarget\);/.test(gpu) && /usable\.faces\.map\(\(f\) => skyPack\.url\(f\)\)/.test(gpu), "an area's own cube (the 'game' source) goes to a target of its own, out of the sky's own pack");
  ok(/if \(!env\.capturing\) \{\s*if \(this\.envTexture\) \{\s*this\.envTexture = null;\s*this\.envWant = null;\s*setEnvironment\(null\);/.test(gpu), "the look switch off hands the registry its stand-in");
  ok(!/fromScene/.test(gpu), "and the 'scene' comparison is WebGL's alone");
  const env = read('src/core/gpu/gpuEnv.ts');
  ok(/new DomeCapture\(domeGen as DomeFilter\)/.test(env) && /const domeGen: Any = atLoad \? new PMREMGenerator\(renderer\) : null;/.test(env) && /standIn = domeGen\.fromCubemap\(cube\)\.texture as THREE\.Texture;/.test(env), "the dome is the WebGL path's own DomeCapture over three's WebGPU generator, which makes the stand-in too");
  ok(/dome\.capture\(\(camera\) => camera\.update\(renderer, new THREE\.Scene\(\)\)\);/.test(env), 'and is warmed with one capture of an empty scene, which makes the kept target');
  ok(/canvas\.width = canvas\.height = DOME_CUBE;/.test(env), "the stand-in's faces are the dome's size");
}

// ---------------------------------------------------------------- 3. the detail map
{
  const tex = new THREE.DataTexture(new Uint8Array([200, 150, 100, 255]), 1, 1);
  const id = surfaces.registerDetail('gpuLooks test', tex);
  const m = new THREE.MeshStandardMaterial();
  m.userData.swgDetail = id;
  applyDetail(m, tex);
  const bare = new THREE.MeshStandardMaterial();
  bare.userData.swgDetail = id;
  ok(detailPart.applies(m) && !detailPart.applies(bare) && m.customProgramCacheKey().startsWith('detail|'), "the part goes on exactly where the detail wrap's key does");
  ok(detailTextureOf(m) === tex, "its texture is the one detailWrap's own lookup hands the WebGL injection");
  const copy = copyOf(m);
  const asked: Any[] = [];
  copy.setupDiffuseColor = function (this: Any) {
    asked.push(this.colorNode);
  };
  detailPart.apply(copy, m);
  const withUv1 = new THREE.BufferGeometry();
  withUv1.setAttribute('uv1', new THREE.Float32BufferAttribute([0, 0], 2));
  copy.setupDiffuseColor({ geometry: withUv1, material: m });
  const colour = asked[0];
  const nodes = graph(colour);
  const tnode = nodes.find((n) => n.isDetailTextureNode) as Any;
  ok(!!tnode && tnode instanceof DetailTextureNode && tnode.updateType === 'object', 'over a geometry with a second set the colour takes a detail texture node, read once an object');
  const uvNodes = graph(tnode.uvNode).filter((n) => n.constructor?.name === 'AttributeNode');
  ok(uvNodes.some((n) => n._attributeName === 'uv1'), 'sampled at the second coordinate set (uv1)');
  tnode.update({ material: m });
  ok(tnode.value === tex, "and its picture is taken off the material three draws");
  ok(uniformsOf(colour).has(detailSwitch()) && detailSwitch().groupNode?.name === 'render', "the colour reads the console's look switch, a render-group uniform");
  ok(nodes.some((n) => n.isMaterialNode || n.scope === 'color'), "the base is three's own material colour (its picture and its colour)");
  const noUv1 = new THREE.BufferGeometry();
  copy.setupDiffuseColor({ geometry: noUv1, material: m });
  ok(asked[1] === null, 'over a geometry with no second set the copy keeps three\'s own colour (nothing at all)');
}

// ---------------------------------------------------------------- 4. the parts on the node library
{
  const met: string[] = [];
  const parts: LookPart[] = [
    { name: 'a', applies: () => true, apply: () => void met.push('a') },
    { name: 'b', applies: (m: Any) => m.userData.b === true, apply: () => void met.push('b') },
  ];
  const standIn = new MeshStandardNodeMaterial();
  const lib = { fromMaterial: (m: Any) => (m.isShaderMaterial ? standIn : m.isNodeMaterial ? m : copyOf(m)) };
  const renderer = { library: lib };
  installLooks(renderer, parts);
  const before = LOOK_STATS.copies;
  const c = new THREE.MeshStandardMaterial();
  c.userData.b = true;
  renderer.library.fromMaterial(c);
  ok(met.join(',') === 'a,b' && LOOK_STATS.copies === before + 1, 'a fresh copy of a classic material meets every part that applies, in order');
  met.length = 0;
  const shader = new THREE.ShaderMaterial();
  ok(renderer.library.fromMaterial(shader) === standIn && met.length === 0, "a stand-in the fallback keeps is never a part's");
  ok(renderer.library.fromMaterial(standIn) === standIn && met.length === 0, 'nor a node material, its own copy');
  const start = read('src/core/gpu/start.ts');
  // Pass 1, wave 2: three's indirect light held at 0.187's goes on before them all (`gpuLightHold.ts`), the model they build on.
  ok(/LOOK_PARTS\.push\(lightHoldPart, detailPart, specPart, cardPart\);/.test(start), 'the game hands the node library the held indirect light first, then the detail, then the highlight, then the leaf cards (which change the highlight\'s model)');
}

// ---------------------------------------------------------------- 5. step 3's stand-ins, mended here
// The sky's capture draws the dome's copy, which never moves: in three's object group a uniform is written only when its
// object is first drawn or its material or matrix moves, so the stand-in's colours were the first capture's for good and
// every reflection on WebGPU was that sky. Every colour and dial a stand-in reads is in the shared render group now.
{
  const horizon = new THREE.Color(0.1, 0.2, 0.3);
  const zenith = new THREE.Color(0.4, 0.5, 0.6);
  const lava = new THREE.Color(1, 0.3, 0);
  const s = makeStandIns();
  // Since step 5 the lava's stand-in is drawn only where the lava's own part was left out at load (`swg.gpu.lava`), the
  // client's lava graph standing in for it otherwise: held here as it is drawn then.
  const lavaPart = LOOKS_AT_LOAD.lava;
  ok(lavaPart === false || !s.lava(lava).colorNode, "with the lava's own part in, the lava is step 5's graph and not step 3's colour");
  LOOKS_AT_LOAD.lava = false;
  const lavaStandIn = s.lava(lava);
  LOOKS_AT_LOAD.lava = lavaPart;
  const reads = [...uniformsOf(s.sky(horizon, zenith).colorNode), ...uniformsOf(lavaStandIn.colorNode), ...uniformsOf(s.ground('grey').colorNode)];
  ok(reads.length >= 5 && reads.every((u) => u.groupNode?.name === 'render'), `every colour and dial the sky, lava and ground stand-ins read is a uniform of the shared render group (${reads.length})`);
  ok(reads.some((u) => u.value === horizon) && reads.some((u) => u.value === zenith) && reads.some((u) => u.value === lava), "the colours are the WebGL path's own objects, by reference");
}

console.log(`gpuLooks: ${checks} checks passed`);
