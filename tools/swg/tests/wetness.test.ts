// The wet wrap, checked without a browser: which materials the scan may wet (never anything
// skinned, held under a bone or under a dry group, never a room, glass, water, the ground or an
// unlit or transparent material), that a material is judged once by the first mesh it is met on,
// that wrapping twice (or again after the cascades replaced the hook) never doubles the program
// key, that the hook runs what came before it and then adds the wet code with the shared uniforms,
// and that a shader missing a stage the wet code writes into is left exactly as it was.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WEATHER_UNIFORMS, applyWetness, injectWetness, isWettable, wetWrap } from '../../../src/world/wetness.ts';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};

const box = new THREE.BoxGeometry(1, 1, 1);
const standard = (userData: Record<string, unknown> = {}) => {
  const m = new THREE.MeshStandardMaterial();
  Object.assign(m.userData, userData);
  return m;
};
const meshOf = (m: THREE.Material) => new THREE.Mesh(box, m);

// Which materials may weather.
{
  const plain = standard();
  ok(isWettable(plain, meshOf(plain)), 'a plain mesh with a standard material is wettable');
  const physical = new THREE.MeshPhysicalMaterial();
  ok(isWettable(physical, meshOf(physical)), 'a physical material is wettable');
  const inst = new THREE.InstancedMesh(box, plain, 4);
  ok(isWettable(plain, inst), 'an instanced mesh (flora) is wettable');
  ok(!isWettable(new THREE.MeshBasicMaterial(), meshOf(new THREE.MeshBasicMaterial())), 'an unlit basic material is not');
  const see = standard();
  see.transparent = true;
  ok(!isWettable(see, meshOf(see)), 'a transparent material is not');
  for (const flag of ['interior', 'dry', 'glass', 'water', 'wetBuiltIn', 'invisible', 'unlit']) {
    const m = standard({ [flag]: true });
    ok(!isWettable(m, meshOf(m)), `a material marked ${flag} is not`);
  }
  const dryGroup = new THREE.Group();
  dryGroup.userData.weatherDry = true;
  const inner = new THREE.Group();
  dryGroup.add(inner);
  const underDry = meshOf(standard());
  inner.add(underDry);
  ok(!isWettable(underDry.material as THREE.Material, underDry), 'a mesh anywhere under a weatherDry group is not');
  const selfDry = meshOf(standard());
  selfDry.userData.weatherDry = true;
  ok(!isWettable(selfDry.material as THREE.Material, selfDry), 'a mesh itself marked weatherDry is not');
  const bone = new THREE.Bone();
  const held = meshOf(standard());
  bone.add(held);
  ok(!isWettable(held.material as THREE.Material, held), 'a mesh held under a bone (a weapon in a hand) is not');
  const skinnedMat = standard();
  const skinned = new THREE.SkinnedMesh(box, skinnedMat);
  ok(!isWettable(skinnedMat, skinned), 'a skinned mesh is not');
  const onSkin = meshOf(standard());
  skinned.add(onSkin);
  ok(!isWettable(onSkin.material as THREE.Material, onSkin), 'a mesh under a skinned mesh is not');
  ok(!isWettable(plain, new THREE.Group()), 'a material met on something that is not a mesh is not');
}

// The wrap: idempotent, and the key is never doubled.
{
  const m = standard();
  const cascades = function cascades(this: THREE.Material, shader: THREE.WebGLProgramParametersWithUniforms) {
    (shader as unknown as { cascadesRan: number }).cascadesRan = ((shader as unknown as { cascadesRan?: number }).cascadesRan ?? 0) + 1;
  };
  m.onBeforeCompile = cascades;
  applyWetness(m);
  const first = m.onBeforeCompile;
  const key1 = m.customProgramCacheKey();
  ok(first !== cascades && key1.startsWith('wet-object|') && !key1.startsWith('wet-object|wet-object|'), 'a wrapped material keys as wet-object| once');
  applyWetness(m);
  ok(m.onBeforeCompile === first && m.customProgramCacheKey() === key1, 'wrapping it again changes nothing');
  // The cascades set up again (forgetMaterials, then adoptMaterials): a new hook, wrapped again.
  const again = function cascadesAgain(this: THREE.Material, shader: THREE.WebGLProgramParametersWithUniforms) {
    (shader as unknown as { againRan: boolean }).againRan = true;
  };
  m.onBeforeCompile = again;
  applyWetness(m);
  const key2 = m.customProgramCacheKey();
  ok(m.onBeforeCompile !== again && key2.startsWith('wet-object|') && !key2.startsWith('wet-object|wet-object|'), 'a hook replaced since is wrapped again, and the key is still wet-object| once');

  // The hook runs what came before it, then writes the wet code in with the shared uniforms.
  const lib = THREE.ShaderLib.physical;
  const shader = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: THREE.UniformsUtils.clone(lib.uniforms) } as unknown as THREE.WebGLProgramParametersWithUniforms;
  m.onBeforeCompile(shader, null as unknown as THREE.WebGLRenderer);
  ok((shader as unknown as { againRan?: boolean }).againRan === true, 'the wrap calls the hook it wraps');
  ok(shader.fragmentShader.includes('uniform float uWetness') && shader.fragmentShader.includes('wetSurface') && shader.vertexShader.includes('vWetPos ='), 'the object wet code is in both stages');
  ok(!shader.fragmentShader.includes('rainRingSlope'), 'an object gets no puddle rings');
  ok(shader.uniforms.uWetness === WEATHER_UNIFORMS.uWetness && shader.uniforms.uRoofMap === WEATHER_UNIFORMS.uRoofMap, 'the uniforms are the shared objects, by reference');
  const colour = shader.fragmentShader.indexOf('#include <color_fragment>');
  const decl = shader.fragmentShader.indexOf('uniform float uWetness');
  const use = shader.fragmentShader.indexOf('float wetSurface');
  ok(decl >= 0 && decl < colour && colour < use, 'the declarations come before the colour stage and the wet colour after it');
}

// The ground mode, and a shader without a stage the wet code needs.
{
  const lib = THREE.ShaderLib.standard;
  const ground = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
  injectWetness(ground, 'ground');
  ok(ground.fragmentShader.includes('rainRingSlope') && ground.fragmentShader.includes('wetPuddle = uPuddles'), 'the ground gets puddles and rings');
  const missing = lib.fragmentShader.replace('#include <color_fragment>', '');
  const lacking = { vertexShader: lib.vertexShader, fragmentShader: missing, uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
  const warns: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => void warns.push(args.join(' '));
  try {
    injectWetness(lacking, 'object');
    injectWetness({ vertexShader: lib.vertexShader, fragmentShader: missing, uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms, 'object');
  } finally {
    console.warn = warn;
  }
  ok(lacking.fragmentShader === missing && lacking.vertexShader === lib.vertexShader && Object.keys(lacking.uniforms).length === 0, 'a shader without <color_fragment> is left exactly as it was');
  ok(warns.length === 1 && warns[0].includes('color_fragment'), 'and it says so once');
}

// The scan: a material is judged once, by the first mesh it is met on.
{
  const shared = standard();
  const dryGroup = new THREE.Group();
  dryGroup.userData.weatherDry = true;
  const first = meshOf(shared);
  dryGroup.add(first);
  wetWrap(shared, first);
  wetWrap(shared, meshOf(shared));
  ok(!shared.customProgramCacheKey().startsWith('wet-object|'), 'a material first met under a dry group stays unwrapped when met again in the open');
  const other = standard();
  wetWrap(other, meshOf(other));
  const moved = meshOf(other);
  dryGroup.add(moved);
  wetWrap(other, moved);
  ok(other.customProgramCacheKey().startsWith('wet-object|'), 'and one first met in the open stays wrapped when met under a dry group');
  // Why the garage marks a ship's own materials dry by the model's kind: that decides for every copy.
  const hull = standard({ dry: true });
  wetWrap(hull, meshOf(hull));
  ok(!hull.customProgramCacheKey().startsWith('wet-object|'), 'a material marked dry is never wrapped, wherever it is met first');
}

console.log(`\n${passed} checks passed`);
