// One program key for many people (the performance pass's fourth wave, `src/world/personKeys.ts`): every skinned
// material and every rack weapon's given, at the world's first sight of it, what it lacks of a superset that changes no
// pixel -- a flat normal map of one float texel, a white roughness and metalness map, the environment at nought -- so
// the shapes their programs come in are a closed product of our own, warmed once a session.
//
//   1. normalisation adds only what a material lacks, is idempotent, and leaves three's unlit kind alone; who is
//      normalised (a skinned mesh's material, a rack weapon's, a copy of one normalised, which is registered in its own
//      right); a blended one named outside as blended, an untextured one as untextured;
//   2. the flat normal, through three's own tangent-frame arithmetic (a `Matrix3` from a random frame times `2t - 1`,
//      in single precision as a GPU does it), gives exactly the frame's normal, whatever the normal scale;
//   3. the white map leaves both factors and a shine mask of one exactly as they were;
//   4. a material with no cube is registered with the environment at the plain strength, nought, and stays at nought
//      whatever the registry's scale and switches say; a cube's own strength is left as it joined;
//   5. a material carrying the flat normal is skipped by the normal-scale rewrite (and the world's two sites ask so);
//   6. `personShapes()` is the product (18 a person's, 6 a weapon's) and every stand-in falls inside it as normalised;
//   7. no depth program's key moves: three's shadow pass copies none of the slots normalisation fills (read off three's
//      own source, not assumed);
//   8. the pixel test's own pieces: taking the superset off and putting it back, the frame report's comparing switch,
//      the previews' swap, the warmed check, the test looks' choice and the picture difference;
//   9. the world's wiring, as text: normalised before the cascades in the same iteration, the stand-ins in every sweep,
//      a body inside the warmed product has its rooms pass pushed at the urgent rank and is deferred otherwise, the
//      records the warm and the in-play count read (and three's own source keeping them), and the pixel test's guards;
//  10. on the packs (SWG3JS_PACKS, else assets-private): how many skinned and rack primitives fall outside the product
//      once normalised, and why (counts only); every one inside has a stand-in of its own shape, and every blended one
//      (the eye films among them) is outside as blended.
import assert from 'node:assert/strict';
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  PERSON_KEYS_LIVE,
  PERSON_KEYS_TUNE,
  PERSON_KEYS_WARM,
  PERSON_TEST_LOOKS,
  allWarmed,
  factsOf,
  flatNormalMap,
  givenTo,
  isFlatNormal,
  isPersonMaterial,
  morphRung,
  normalisePerson,
  noteWarmed,
  outsideWhy,
  personShapes,
  pickTestLooks,
  pixelDiff,
  setGiven,
  setPersonKeysLive,
  shapeKey,
  shapeName,
  signatureStandIns,
  takesNormalScale,
  whiteMap,
  type ProgramLike,
} from '../../../src/world/personKeys.ts';
import { EnvironmentSwap, REFLECTIONS, isRegisteredReflective, registerReflective, setEnvironment, setModelReflections, setPlainReflections, takesEnvironment } from '../../../src/world/envmap.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const repo = (p: string): string => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

ok(PERSON_KEYS_TUNE.on, 'node has no storage: the person keys are on, as a session with no hatch set is');

// An environment the registry hands out (a filtered cube's texture, as far as these tests need one).
const env = new THREE.Texture();
env.mapping = THREE.CubeUVReflectionMapping;
setEnvironment(env, 1);

/** A skinned mesh of a person's shape for a material to be met on: `morphs` targets with normals, as the ladder pads them. */
function body(material: THREE.Material, morphs = 0): THREE.SkinnedMesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  if (morphs) {
    g.morphAttributes.position = [];
    g.morphAttributes.normal = [];
    for (let i = 0; i < morphs; i++) {
      g.morphAttributes.position.push(new THREE.Float32BufferAttribute(new Float32Array(9), 3));
      g.morphAttributes.normal.push(new THREE.Float32BufferAttribute(new Float32Array(9), 3));
    }
  }
  return new THREE.SkinnedMesh(g, material);
}

function personMaterial(opts: { cube?: boolean; normal?: boolean; mr?: boolean } = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
  m.userData.swgSpec = { mode: 'phong', color: [0.5, 0.5, 0.5], power: 20 };
  m.userData.swgCube = opts.cube ?? false;
  if (opts.normal) m.normalMap = new THREE.Texture();
  if (opts.mr) {
    const t = new THREE.Texture();
    m.roughnessMap = t;
    m.metalnessMap = t;
  }
  return m;
}

// ---- 1. Only what is lacking, idempotent, the unlit kind left alone. ----
{
  const plain = personMaterial();
  const mesh = body(plain, 7);
  const version = plain.version;
  ok(normalisePerson(plain, mesh), 'a plain person material is given the superset');
  ok(plain.normalMap === flatNormalMap() && isFlatNormal(plain), 'its normal map is the session\'s flat one');
  ok(plain.roughnessMap === whiteMap() && plain.metalnessMap === whiteMap(), 'its roughness and metalness maps the session\'s one white texel');
  ok(isRegisteredReflective(plain) && plain.envMap === env && plain.userData.swgPersonEnv === true, 'and it carries the world\'s environment, registered');
  ok(plain.version > version, 'and three is told to work its program out again (before anything has compiled it)');
  const g = givenTo(plain)!;
  ok(g.normal && g.roughness && g.metalness && g.env, 'what was given is recorded, for the pixel test to take off and put back');
  const again = plain.version;
  ok(!normalisePerson(plain, mesh) && plain.version === again && plain.normalMap === flatNormalMap(), 'a second call gives nothing and moves nothing: idempotent');

  const own = personMaterial({ cube: true, normal: true, mr: true });
  const ownNormal = own.normalMap;
  const ownMr = own.roughnessMap;
  own.envMapIntensity = 0.7;
  registerReflective(own); // what `joinModelReflections` did before, a shader with a cube
  const strength = own.envMapIntensity;
  normalisePerson(own, body(own));
  ok(own.normalMap === ownNormal && own.roughnessMap === ownMr && own.metalnessMap === ownMr, 'a material with every map of its own keeps every one');
  ok(own.envMapIntensity === strength && own.userData.swgPersonEnv === undefined, 'and a cube joined as a model\'s keeps the strength it joined with, untouched');

  const half = personMaterial({ normal: true });
  const halfNormal = half.normalMap;
  normalisePerson(half, body(half));
  ok(half.normalMap === halfNormal && half.roughnessMap === whiteMap() && half.metalnessMap === whiteMap(), 'a material with a normal map of its own and no metal-rough image is given only the white maps');
  const g2 = givenTo(half)!;
  ok(!g2.normal && g2.roughness && g2.metalness, 'and only those are recorded as given');

  const basic = new THREE.MeshBasicMaterial({ map: new THREE.Texture() });
  ok(!normalisePerson(basic, body(basic)) && !(basic as unknown as THREE.MeshStandardMaterial).normalMap && !isRegisteredReflective(basic as unknown as THREE.MeshStandardMaterial), 'an unlit material (three\'s basic kind) is left alone');
  ok(outsideWhy(basic, factsOf(body(basic)), 'person').join() === 'unlit', 'and is named outside the product as unlit');

  // Who is normalised (`isPersonMaterial`, the one rule the world's adoption asks): a skinned mesh's material, a rack
  // weapon's by the rack's mark, and a copy of one normalised by the mark it carries; nothing else.
  const rigid = (mat: THREE.Material): THREE.Mesh => new THREE.Mesh(new THREE.BufferGeometry(), mat);
  const onSkin = personMaterial();
  ok(isPersonMaterial(onSkin, body(onSkin)), 'a material on a skinned mesh is a person\'s, whoever loaded it');
  const held = personMaterial();
  held.userData.swgRack = true;
  ok(isPersonMaterial(held, rigid(held)), 'a rack weapon\'s material on its rigid mesh is one too, told by the mark the rack puts on at load');
  const prop = personMaterial();
  ok(!isPersonMaterial(prop, rigid(prop)) && !isPersonMaterial(prop, null), 'a material on a rigid mesh with no mark (a prop, a building, a hull) is not');
  const copy = plain.clone();
  ok(isPersonMaterial(copy, rigid(copy)), 'a copy of a normalised material (a ship\'s paint copy, a ghost) is one, by the mark its userData carries');
  ok(!isRegisteredReflective(copy), 'and before it is adopted it is not registered: the registry holds materials, not their marks');
  normalisePerson(copy, rigid(copy));
  ok(isRegisteredReflective(copy) && copy.envMap === env && copy.envMapIntensity === 0 && copy.normalMap === flatNormalMap() && copy.roughnessMap === whiteMap(), 'adopted, it is registered in its own right with the environment at nought, its maps the ones it came with');

  // What falls outside is named as what it is.
  const film = personMaterial();
  film.transparent = true;
  normalisePerson(film, body(film));
  ok(film.normalMap === flatNormalMap() && outsideWhy(film, factsOf(body(film)), 'person').includes('blended'), 'a blended person material (an eye film) is normalised all the same and named outside the product as blended');
  const bare = new THREE.MeshStandardMaterial();
  const bareWhy = outsideWhy(bare, factsOf(body(bare)), 'person');
  ok(bareWhy.includes('no colour map (untextured)') && !bareWhy.some((w) => /format 6/.test(w)), `an untextured material (the body's untextured skin placeholder) is named as untextured, never as a pack from before format 6 (${bareWhy.join(', ')})`);
  const old = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
  ok(outsideWhy(old, factsOf(body(old)), 'person').includes('no highlight record (a pack from before format 6)'), 'a textured material with no highlight record is the one named as a pack from before format 6');
}

// ---- 2. The flat normal through three's own tangent-frame arithmetic gives exactly the frame's normal. ----
{
  const texel = flatNormalMap().image.data as Float32Array;
  ok(texel instanceof Float32Array && texel[0] === 0.5 && texel[1] === 0.5 && texel[2] === 1, 'the flat normal is one float texel of exactly (0.5, 0.5, 1)');
  const t = flatNormalMap();
  ok(t.type === THREE.FloatType && t.magFilter === THREE.NearestFilter && t.minFilter === THREE.NearestFilter && !t.generateMipmaps && t.colorSpace === THREE.NoColorSpace, 'stored as floats, nearest, no mipmaps, no colour space (a float texture complete without the linear-filtering extension)');
  const f = Math.fround;
  // `mapN = texture2D(normalMap, uv).xyz * 2.0 - 1.0; mapN.xy *= normalScale;` in single precision.
  const mapN = (scale: [number, number]): THREE.Vector3 => new THREE.Vector3(f(f(f(texel[0] * 2) - 1) * scale[0]), f(f(f(texel[1] * 2) - 1) * scale[1]), f(f(texel[2] * 2) - 1));
  let seed = 12345;
  const rand = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return f((seed / 0x7fffffff) * 4 - 2);
  };
  let exact = 0;
  const trials = 2000;
  for (let i = 0; i < trials; i++) {
    const T = new THREE.Vector3(rand(), rand(), rand());
    const B = new THREE.Vector3(rand(), rand(), rand());
    const N = new THREE.Vector3(rand(), rand(), rand()).normalize();
    const tbn = new THREE.Matrix3().set(T.x, B.x, N.x, T.y, B.y, N.y, T.z, B.z, N.z);
    const n = mapN([rand(), rand()]).applyMatrix3(tbn);
    if (Object.is(n.x, N.x) && Object.is(n.y, N.y) && Object.is(n.z, N.z)) exact++;
  }
  ok(exact === trials, `over ${trials} random frames and normal scales, tbn * (2t - 1) is exactly the frame's normal (${exact})`);
  // In single precision too, each product and sum rounded as the GPU rounds them: 0 * T and 0 * B are nought, 1 * N is N.
  let exact32 = 0;
  for (let i = 0; i < trials; i++) {
    const T = [rand(), rand(), rand()];
    const B = [rand(), rand(), rand()];
    const N = [rand(), rand(), rand()];
    const m = mapN([rand(), rand()]);
    const out = [0, 1, 2].map((k) => f(f(f(T[k] * m.x) + f(B[k] * m.y)) + f(N[k] * m.z)));
    if (out.every((v, k) => Object.is(v, N[k]) || (v === 0 && N[k] === 0))) exact32++;
  }
  ok(exact32 === trials, `and summed in single precision (${exact32})`);
}

// ---- 3. The white map: both factors and a shine mask of one, exactly. ----
{
  const texel = whiteMap().image.data as Uint8Array;
  ok(texel instanceof Uint8Array && texel.every((v) => v === 255), 'the white map is one texel of 255 in every channel');
  const unit = texel[1] / 255; // an eight-bit texel is read as v / 255, exactly 1 at 255
  ok(unit === 1, 'read as a normalised byte, 255 is exactly one');
  let same = 0;
  for (let i = 0; i < 1000; i++) {
    const roughness = Math.fround(Math.random());
    const metalness = Math.fround(Math.random());
    // roughnessmap_fragment: roughnessFactor *= texelRoughness.g; metalnessmap_fragment: metalnessFactor *= texelMetalness.b.
    if (Object.is(Math.fround(roughness * (texel[1] / 255)), roughness) && Object.is(Math.fround(metalness * (texel[2] / 255)), metalness)) same++;
  }
  ok(same === 1000, 'both factors come out of the multiply exactly as they went in');
  const spec = repo('src/world/specular.ts');
  ok(/float swgSpecMask = 1\.0;/.test(spec) && /#ifdef USE_ROUGHNESSMAP\s*swgSpecMask = texelRoughness\.r;/.test(spec), "the highlight's mask is one where there is no roughness map and the map's red where there is: the white texel's red is that one");
  const chunks = THREE.ShaderChunk;
  ok(/roughnessFactor \*= texelRoughness\.g;/.test(chunks.roughnessmap_fragment) && /metalnessFactor \*= texelMetalness\.b;/.test(chunks.metalnessmap_fragment), "three 0.185's own chunks multiply the factors by the map's green and blue, as read here");
  // The packed (two-channel) branch between is taken only for a red-green texture, which the flat normal is not.
  ok(/vec3 mapN = texture2D\( normalMap, vNormalMapUv \)\.xyz \* 2\.0 - 1\.0;\s*#if defined\( USE_PACKED_NORMALMAP \)[\s\S]*?#endif\s*mapN\.xy \*= normalScale;\s*normal = normalize\( tbn \* mapN \);/.test(chunks.normal_fragment_maps) && flatNormalMap().format === THREE.RGBAFormat, "and three's own normal-map chunk is the arithmetic test 2 holds (the flat normal is four channels, never the packed branch)");
  ok(/mat3 tbn = getTangentFrame\( - vViewPosition, normal,/.test(chunks.normal_fragment_begin) && /vec3 normal = normalize\( vNormal \);/.test(chunks.normal_fragment_begin), "whose frame's third column is the interpolated normal already normalised, so what is left is normalising a unit vector again: a last-place rounding at most");
}

// ---- 4. The environment at nought, whatever the registry says; the stand-in carried along. ----
{
  const plain = personMaterial();
  plain.envMapIntensity = 1; // the glTF loader's own value, which the registry must not take for the strength
  normalisePerson(plain, body(plain));
  ok(plain.envMapIntensity === 0 && plain.userData.swgEnvBase === 0, 'a material with no cube joins at strength nought, its base written as nought');
  setPlainReflections(1);
  ok(plain.envMapIntensity === 0, 'and the plain surfaces\' share turned up to one leaves it at nought (its own base is nought)');
  setPlainReflections(0);
  setModelReflections(false);
  setModelReflections(true);
  const next = new THREE.Texture();
  next.mapping = THREE.CubeUVReflectionMapping;
  setEnvironment(next, 2.5);
  ok(plain.envMap === next && plain.envMapIntensity === 0, 'a new sky swapped in at any scale is carried, at nought');
  setEnvironment(env, 1);
  REFLECTIONS.plain = 0;
}

// ---- 5. The normal-scale rewrite skips the flat normal; the world asks so at both sites. ----
{
  const flat = personMaterial();
  normalisePerson(flat, body(flat));
  const real = personMaterial({ normal: true });
  normalisePerson(real, body(real));
  ok(!takesNormalScale(flat) && takesNormalScale(real), 'the flat normal takes no scale; a normal map of its own does');
  flat.normalMap = new THREE.Texture(); // a recipe's own normal map put on it later (`Customizer.onSlot`)
  ok(takesNormalScale(flat) && !isFlatNormal(flat), 'and one whose flat normal a recipe replaced takes the scale again');
  const world = repo('src/world/world.ts');
  ok(/if \(takesNormalScale\(m\)\) std\.normalScale\.copy\(this\.normalScale\);/.test(world), 'the world\'s adoption copies its scale only where it is taken');
  ok(/setNormalScale\(x: number, y: number\): number \{[\s\S]{0,600}if \(takesNormalScale\(std\)\) \{\s*std\.normalScale\.set\(x, y\);/.test(world), 'and so does `__debug.normals`\' live rewrite');
}

// ---- 6. The product, and its stand-ins inside it. ----
{
  const shapes = personShapes();
  const names = new Set(shapes.map(shapeName));
  ok(shapes.length === 24 && names.size === 24, `the product is ${shapes.length} shapes, each its own (${names.size})`);
  ok(shapes.filter((s) => s.kind === 'person').length === PERSON_KEYS_TUNE.morphLadder.length * 3 * 2, 'a person\'s: every rung of the ladder by the three sides by opaque or cut, 18');
  ok(shapes.filter((s) => s.kind === 'rack').length === 6 && shapes.filter((s) => s.kind === 'rack').every((s) => s.rung === 0), 'a rack weapon\'s: rigid, no morphs, the three sides by opaque or cut, 6');
  for (const rung of PERSON_KEYS_TUNE.morphLadder) for (const side of ['front', 'back', 'double']) for (const cut of [false, true]) ok(names.has(`person r${rung} ${side} ${cut ? 'cut' : 'opaque'}`), `person r${rung} ${side} ${cut ? 'cut' : 'opaque'} is in it`);
  ok(personShapes(null).filter((s) => s.kind === 'person').length === 6, 'with the ladder\'s hatch off a person\'s shapes are rung nought\'s alone');
  const standIns = signatureStandIns();
  ok(standIns.length === shapes.length && signatureStandIns() === standIns, 'one stand-in a shape, made once a session');
  let inside = 0;
  standIns.forEach((s, i) => {
    const shape = shapes[i];
    const m = s.material as THREE.MeshStandardMaterial;
    const skinned = (s as THREE.SkinnedMesh).isSkinnedMesh === true;
    const morphs = s.geometry.morphAttributes.position?.length ?? 0;
    const sideOk = m.side === (shape.side === 'double' ? THREE.DoubleSide : shape.side === 'back' ? THREE.BackSide : THREE.FrontSide);
    const shapeOk = skinned === (shape.kind === 'person') && morphs === shape.rung && (morphs === 0 || s.geometry.morphAttributes.normal?.length === morphs) && sideOk && m.alphaTest > 0 === shape.cut;
    normalisePerson(m, s);
    if (shapeOk && outsideWhy(m, factsOf(s), shape.kind).length === 0) inside++;
  });
  ok(inside === standIns.length, `every stand-in is its shape (skinned with the rung's morphs, or rigid) and, normalised, falls inside the product (${inside})`);
  const keys = new Set(standIns.map((s) => shapeKey(s.material as THREE.Material, factsOf(s))));
  ok(keys.size === standIns.length, `and \`shapeKey\` tells every one of them apart (${keys.size} keys for ${standIns.length}): a key that dropped a side, a cut or a rung would let the packs' check below pass on a shape no stand-in compiles`);
  ok(standIns.every((s) => (s.material as THREE.Material).userData.swgStandIn === true && (s.material as THREE.MeshStandardMaterial).map !== null && !!(s.material as THREE.Material).userData.swgSpec), 'each marked as ours, with a colour map and a highlight record as a format-6 person\'s');
  ok(standIns.filter((s) => !(s as THREE.SkinnedMesh).isSkinnedMesh).every((s) => (s.material as THREE.Material).userData.dry === true && (s.material as THREE.Material).userData.swgRack === true), 'a rack stand-in is dry and marked a rack weapon\'s, as the rack marks every held weapon\'s');
  ok(standIns.filter((s) => (s as THREE.SkinnedMesh).isSkinnedMesh).every((s) => (s.geometry.getAttribute('skinIndex') as THREE.BufferAttribute).array instanceof Float32Array), 'a person\'s stand-in carries its joints as floats, as every skinned mesh is made at load');
  const weapons = repo('src/player/weapons.ts');
  ok(/mat\.userData\.dry = true;\s*mat\.userData\.swgRack = true;/.test(weapons), 'and the rack marks every weapon model\'s materials so as it loads');
}

// ---- 7. No depth program's key moves: three's shadow pass copies none of the slots normalisation fills. ----
{
  const src = repo('node_modules/three/src/renderers/webgl/WebGLShadowMap.js');
  const fn = src.slice(src.indexOf('function getDepthMaterial('), src.indexOf('function renderObject('));
  ok(fn.length > 200, 'three\'s own `getDepthMaterial` read off its source');
  const read = new Set<string>();
  for (const m of fn.matchAll(/\bmaterial\.(\w+)/g)) read.add(m[1]);
  ok(read.has('map') && read.has('alphaTest') && read.has('side'), `the source fields three's shadow pass reads off a caster's material: ${[...read].sort().join(', ')}`);
  const filled = ['normalMap', 'roughnessMap', 'metalnessMap', 'envMap', 'envMapIntensity', 'normalScale'];
  ok(filled.every((f) => !read.has(f)), 'and none of them is a slot normalisation fills (normal, roughness, metalness, environment)');
  const m = personMaterial();
  m.alphaTest = 0.5;
  m.side = THREE.DoubleSide;
  const before = [...read].map((f) => (m as unknown as Record<string, unknown>)[f]);
  normalisePerson(m, body(m, 7));
  const after = [...read].map((f) => (m as unknown as Record<string, unknown>)[f]);
  ok(before.every((v, i) => Object.is(v, after[i])), 'so a person\'s material normalised hands the shadow pass exactly what it did before');
}

// ---- 8. The pixel test's own pieces. ----
{
  // Taking the superset off and putting it back.
  const m = personMaterial();
  normalisePerson(m, body(m));
  const version = m.version;
  ok(setGiven(m, false) && m.normalMap === null && m.roughnessMap === null && m.metalnessMap === null && m.envMap === null && !isRegisteredReflective(m), 'taken off, every slot it gave is empty and the environment out of the registry');
  ok(m.version > version, 'and three is told to work the program out again');
  ok(setGiven(m, true) && m.normalMap === flatNormalMap() && m.roughnessMap === whiteMap() && m.metalnessMap === whiteMap() && m.envMap === env && isRegisteredReflective(m) && m.envMapIntensity === 0, 'put back, exactly the same textures and the environment at nought');
  ok(!setGiven(m, true), 'and a second put back changes nothing');
  const recipe = new THREE.Texture();
  m.normalMap = recipe;
  setGiven(m, false);
  ok(m.normalMap === recipe, 'a slot a recipe has filled since is left alone when the superset comes off');
  setGiven(m, true);

  // The frame report's comparing switch (`perf({ ab: { key: 'personKeys' } })`): the superset off every material met
  // this session, and back on, or the comparison is of one state with itself.
  const l1 = personMaterial();
  normalisePerson(l1, body(l1));
  const l2 = personMaterial({ normal: true });
  const l2Normal = l2.normalMap;
  normalisePerson(l2, body(l2));
  const liveOff = setPersonKeysLive(false);
  ok(liveOff >= 2 && !PERSON_KEYS_LIVE.on, `the switch off takes the superset off every material met (${liveOff} changed) and says so`);
  ok(l1.normalMap === null && l1.roughnessMap === null && l1.metalnessMap === null && l1.envMap === null && !isRegisteredReflective(l1), 'a material given everything is left with none of it');
  ok(l2.normalMap === l2Normal && l2.roughnessMap === null && l2.metalnessMap === null, 'and one with a normal map of its own keeps it, losing only what it was given');
  const liveOn = setPersonKeysLive(true);
  ok(liveOn === liveOff && PERSON_KEYS_LIVE.on, `back on, it puts back exactly as many (${liveOn})`);
  ok(l1.normalMap === flatNormalMap() && l1.roughnessMap === whiteMap() && l1.metalnessMap === whiteMap() && l1.envMap === env && isRegisteredReflective(l1) && l1.envMapIntensity === 0, 'every slot it emptied filled again with the same textures, the environment at nought');
  ok(l2.normalMap === l2Normal && l2.roughnessMap === whiteMap() && l2.metalnessMap === whiteMap(), 'and the other\'s white maps back beside its own normal map');

  // The previews' swap: a person's environment at nought takes the studio at nought; one taken off is left alone.
  const studio = new THREE.Texture();
  studio.mapping = THREE.CubeUVReflectionMapping;
  const p = personMaterial();
  const mesh = body(p);
  normalisePerson(p, mesh);
  ok(takesEnvironment(mesh), 'a figure wearing a normalised person\'s material is one the preview makes its studio for');
  const swap = new EnvironmentSwap();
  swap.on(mesh, studio);
  ok(p.envMap === studio && p.envMapIntensity === 0 && swap.last === 1, 'in a preview\'s draw it carries the studio, at nought');
  swap.off();
  ok(p.envMap === env && p.envMapIntensity === 0, 'and after it the world\'s environment again, at nought');
  setGiven(p, false);
  swap.on(mesh, studio);
  ok(p.envMap === null && swap.last === 0, 'with the superset taken off (the pixel test\'s other draw) it takes no studio, as before the wave');
  swap.off();
  setGiven(p, true);

  // The warmed check reads the renderer's records: every program warmed, at least one each.
  const warm: ProgramLike = { id: 1, cacheKey: 'warm' };
  const cold: ProgramLike = { id: 2, cacheKey: 'cold' };
  const records = new Map<THREE.Material, ProgramLike[]>();
  const programsOf = (mat: THREE.Material): ProgramLike[] | null => records.get(mat) ?? null;
  const a = personMaterial();
  const b = personMaterial();
  const ma = body(a);
  const mb = body(b);
  ok(!allWarmed([ma], programsOf), 'nothing is warm before any warm');
  records.set(signatureStandIns()[0].material as THREE.Material, [warm]);
  noteWarmed(programsOf);
  ok(PERSON_KEYS_WARM.programs.has(warm), 'a warm notes every program its stand-ins hold');
  records.set(a, [warm]);
  records.set(b, [warm, cold]);
  ok(allWarmed([ma], programsOf), 'a body whose every material is on warmed programs is warm');
  ok(!allWarmed([ma, mb], programsOf), 'one material on a program the warm did not build and it is not');
  records.set(b, []);
  ok(!allWarmed([mb], programsOf), 'nor is one never compiled');
  PERSON_KEYS_WARM.programs.clear();

  // The test looks: the species by the dressed body, a word otherwise, the robed Jedi first, nothing unstandable.
  const entries = [
    { id: 'z_rodian', kind: 'dressed', name: 'Rodian', species: 'characters/rodian_male', outfit: [] },
    { id: 'a_rodian', kind: 'dressed', name: 'Rodian', species: 'characters/rodian_male', outfit: [] },
    { id: 'jedi_a', kind: 'dressed', name: 'Jedi', species: 'characters/human_male', outfit: [{ item: 'shirt_s01' }] },
    { id: 'jedi_b', kind: 'dressed', name: 'Jedi', species: 'characters/human_male', outfit: [{ item: 'robe_jedi_dark_s05' }] },
    { id: 'bantha', kind: 'creature', name: 'Bantha', species: null, outfit: [] },
    { id: 'bantha_npc', kind: 'npc', name: 'Bantha rider', species: null, outfit: [] },
  ];
  const picked = pickTestLooks(entries, (e) => e.id !== 'a_rodian');
  const by = (label: string) => picked.find((x) => x.label === label);
  ok(picked.length === PERSON_TEST_LOOKS.length, `every test look is answered (${picked.length})`);
  ok(by('a rodian')?.entry?.id === 'z_rodian', 'a species is its dressed body\'s first by id that can be stood');
  ok(by('a robed Jedi')?.entry?.id === 'jedi_b', 'the Jedi wearing a robe goes first');
  ok(by('a creature')?.entry?.id === 'bantha', 'the creature is a creature of its word');
  ok(by('a wookiee')?.entry === null && /nothing/.test(by('a wookiee')!.why), 'and a look nothing matches says so');
  ok(pickTestLooks(entries, () => true, ['bantha_npc']).map((x) => x.entry?.id).join() === 'bantha_npc', 'the console\'s own looks replace the list');

  // The picture difference: the largest channel and the mean of each pixel's largest, over the mask.
  const x = new Uint8Array([10, 10, 10, 255, 20, 20, 20, 255, 0, 0, 0, 255]);
  const y = new Uint8Array([11, 10, 12, 255, 20, 20, 20, 255, 90, 0, 0, 255]);
  const d = pixelDiff(x, y, (i) => i < 8);
  ok(d.pixels === 2 && d.max === 2 && d.mean === 1, 'two pixels in the mask, the largest difference 2 and the mean 1; the third pixel, outside it, is not counted');
}

// ---- 9. The world's wiring, as text. ----
{
  const world = repo('src/world/world.ts');
  const adopt = world.slice(world.indexOf('  adoptMaterials(root: THREE.Object3D): THREE.Object3D[] {'), world.indexOf('  async prepareActor('));
  const join = adopt.indexOf('if (m.userData.swgCube === true) joinModelReflections(m);');
  const norm = adopt.indexOf('if (isPersonMaterial(m, o)) normalisePerson(m, o);');
  const csm = adopt.indexOf('csm.setupMaterial(m);');
  const wet = adopt.indexOf('if (csm && WET_WRAP) wetWrap(m, o);');
  const spec = adopt.indexOf('if (m.userData.swgSpec) specWrap(m);');
  ok(join > 0 && norm > join && csm > norm && wet > csm && spec > wet, 'adoption normalises a person\'s material after the cube\'s own join and before the cascades and every wrap');
  ok(adopt.slice(adopt.indexOf('if (!this.compiledMaterials.has(m)) {'), csm).includes('normalisePerson'), 'at its first sight, in the same iteration as the cascades\' setup');
  const everything = world.slice(world.indexOf('  private async compileEverything('), world.indexOf('  private depthWarmTarget'));
  ok(/const people = PERSON_KEYS_TUNE\.on && this\.csm \? this\.personStandIns\(\) : \[\];\s*for \(const o of people\) objects\.push\(o\);/.test(everything) && /if \(people\.length\) noteWarmed\(this\.programsOf\);/.test(everything), 'every sweep compiles the stand-ins too and notes their programs as warm');
  const warm = world.slice(world.indexOf('  async warmPersonShapes(): Promise<number> {'));
  ok(/await this\.sweepBatches\(r, camera, list, this\.compileTarget\(\), \(\) => \{\}\);\s*noteWarmed\(this\.programsOf\);/.test(warm), 'the warm sweeps the stand-ins for every pass that draws them, for the frames\' own target, and notes what they hold');
  const stands = world.slice(world.indexOf('  private personStandIns(): THREE.Mesh[] {'));
  ok(/for \(const s of list\) markActor\(s\);/.test(stands) && /for \(const s of list\) this\.adoptMaterials\(s\);/.test(stands), 'the stand-ins are actors (both passes) and adopted as any person\'s material is');
  const ready = world.slice(world.indexOf('  async compileReady('), world.indexOf('  private static hasLight('));
  ok(/await this\.queueOrBuild\(meshes, what, true, this\.worldOnlyJob\);\s*\/\/[^\n]*\n(\s*\/\/[^\n]*\n)*\s*if \(allWarmed\(meshes, this\.programsOf\)\) \{/.test(ready), 'a body stood outdoors whose world pass came out on warmed programs is asked about first, before any deferral');
  ok(/if \(allWarmed\(meshes, this\.programsOf\)\) \{\s*PERSON_KEYS_STATS\.roomReady\+\+;\s*urgentRooms\(later, meshes, `\$\{what\} \(its rooms, warm\)`, this\.roomsOnly, this\.roomQueue, \(built\) => \{[\s\S]*?\n {10}\}\);\n {8}\} else \{\n(\s*\/\/[^\n]*\n)*\s*deferRooms\(later, meshes, `\$\{what\} \(its rooms\)`, this\.roomsOnly, this\.roomQueue\);\n {8}\}/.test(ready), 'a warm body\'s rooms pass is pushed at the urgent rank through the queue, and the deferral is the else\'s alone');
  const warmAt = ready.indexOf('if (allWarmed(meshes, this.programsOf)) {');
  const elseAt = ready.indexOf('} else {', warmAt);
  const warmBranch = ready.slice(warmAt, elseAt);
  ok(warmAt > 0 && elseAt > warmAt && !warmBranch.includes('deferRooms(') && !warmBranch.includes('later.ready = true'), 'nothing in the warm branch defers, and nothing there marks the handle ready before its rooms pass is answered');
  ok(!/this\.compileOne\([^)]*'rooms'\)/.test(ready), 'and no rooms pass is compiled outright in `compileReady`: unbudgeted on one frame, a hole built and waited for there');
  const defer = repo('src/world/roomDefer.ts');
  ok(/export function urgentRooms\([\s\S]*?pushRooms\(later, objects, label, counted, queue, true, /.test(defer), '`urgentRooms` pushes through the same queue as a deferral, at the urgent rank');
  // The records the warm and the in-play count read: the renderer's own, and where three 0.185 keeps them.
  ok(/readonly programsOf: ProgramsOf = \(m\) => \{\s*const props = this\.renderer\?\.properties as [^\n]*\| undefined;\s*if \(!props \|\| !props\.has\(m\)\) return null;\s*return props\.get\(m\)\.programs\?\.values\(\) \?\? null;\s*\};/.test(world),"the world reads a material's programs off its renderer's own records (`programsOf`), nothing copied");
  const three = repo('node_modules/three/src/renderers/WebGLRenderer.js');
  ok(/materialProperties\.programs = programs;/.test(three) && /programs\.set\( programCacheKey, program \);/.test(three), "which is where three keeps them: one map a material, by cache key (`WebGLRenderer.getProgram`)");
  const webglProgram = repo('node_modules/three/src/renderers/webgl/WebGLProgram.js');
  ok(/this\.id = programIdCount \+\+;/.test(webglProgram) && /this\.cacheKey = cacheKey;/.test(webglProgram), "and each program carries the id and the cache key the warm's set and the in-play count read");
  const env = repo('src/world/envmap.ts');
  ok(/else if \(m\.userData\.swgPersonEnv === true && m\.envMap !== null\) k = REFLECTIONS\.plain;/.test(env), 'the previews\' swap takes a person\'s environment at the plain share');
  const main = repo('src/main.ts');
  ok(/registerPerfSwitch\('personKeys', \{/.test(main) && /setPersonKeysLive\(!!v\)/.test(main), 'the comparing switch is registered for the frame report');
  ok(/const ps = programsOf\(m\);[\s\S]{0,300}?this\.shaderWatch\.phaseOf\(p\.cacheKey\) === 'play'/.test(main), "`personKeys().inPlay` counts a material's programs by the phase the shader watch saw each key built in");
  // The pixel test's guards.
  const test = main.slice(main.indexOf('  private async personKeysSelfTest('), main.indexOf('  private static pngOf('));
  ok(/const restoreRecords = this\.world\.keepShadowRecords\(\[\.\.\.worn\]\);[\s\S]*?for \(const \[name, p\] of previews\)[\s\S]*?\} finally \{\s*restoreRecords\(\);/.test(test), "the previews' compiles of the look's shared materials are wrapped in the cascades' records kept and put back");
  ok(/all\.every\(\(d\) => d\.restored === 0 && d\.pixels > 0 && d\.taken > 0\)/.test(test), 'a look passes only where every picture held a figure and the superset came off');
  ok(/const pass = tested\.length > 0 && untested\.length === 0 && over\.length === 0;/.test(test), 'and the run only where every look asked was compared');
}

// ---- 10. On the packs: how many skinned and rack primitives fall outside the product once normalised (counts only). ----
{
  const PACKS = process.env.SWG3JS_PACKS ?? fileURLToPath(new URL('../../../assets-private/', import.meta.url));
  const SKINNED = ['wardrobe', 'characters', 'player', join('mobiles', 'models'), join('mobiles', 'wearables'), join('mobiles', 'variants'), 'creatures', 'gallery', 'travel'];
  interface GltfMaterial {
    name?: string;
    alphaMode?: string;
    doubleSided?: boolean;
    pbrMetallicRoughness?: { baseColorTexture?: { texCoord?: number }; metallicRoughnessTexture?: { texCoord?: number } };
    normalTexture?: { texCoord?: number };
    emissiveTexture?: unknown;
    occlusionTexture?: unknown;
    extensions?: Record<string, unknown>;
    extras?: Record<string, unknown>;
  }
  interface GltfJson {
    nodes?: { mesh?: number; skin?: number }[];
    meshes?: { primitives?: { attributes: Record<string, number>; targets?: Record<string, number>[]; material?: number }[] }[];
    materials?: GltfMaterial[];
  }
  const glbJson = (file: string): GltfJson | null => {
    const fd = openSync(file, 'r');
    try {
      const head = Buffer.alloc(20);
      readSync(fd, head, 0, 20, 0);
      if (head.readUInt32LE(0) !== 0x46546c67 || head.readUInt32LE(16) !== 0x4e4f534a) return null;
      const bodyBuf = Buffer.alloc(head.readUInt32LE(12));
      readSync(fd, bodyBuf, 0, bodyBuf.length, 20);
      return JSON.parse(bodyBuf.toString('utf8')) as GltfJson;
    } catch {
      return null;
    } finally {
      closeSync(fd);
    }
  };
  const glbs = (dir: string, out: string[]): string[] => {
    if (!existsSync(dir)) return out;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) glbs(p, out);
      else if (e.name.endsWith('.glb') && e.name !== 'rig.glb') out.push(p);
    }
    return out;
  };
  // A file a pack still names (by a JSON at or above its own folder): a pack folder also holds files no manifest names
  // any more, written by older runs and drawn by nothing.
  const named = new Map<string, Set<string>>();
  const namesIn = (dir: string): Set<string> => {
    let s = named.get(dir);
    if (s) return s;
    s = new Set<string>();
    if (existsSync(dir)) for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isFile() && e.name.endsWith('.json')) for (const m of readFileSync(join(dir, e.name), 'utf8').matchAll(/([A-Za-z0-9_.\-]+\.glb)/g)) s.add(m[1].toLowerCase());
    named.set(dir, s);
    return s;
  };
  const isNamed = (file: string): boolean => {
    const base = file.slice(Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')) + 1).toLowerCase();
    for (let d = dirname(file); d.length >= PACKS.length - 1; d = dirname(d)) {
      if (namesIn(d).has(base)) return true;
      if (d === dirname(d)) break;
    }
    return false;
  };
  /** The material three's glTF loader makes of a glTF material, as far as the product reads one. */
  const materialOf = (g: GltfMaterial | undefined, colours: boolean): THREE.Material => {
    const tex = (t: { texCoord?: number } | undefined): THREE.Texture | null => {
      if (!t) return null;
      const x = new THREE.Texture();
      x.channel = t.texCoord ?? 0;
      return x;
    };
    if (g?.extensions?.KHR_materials_unlit) return new THREE.MeshBasicMaterial();
    const m = new THREE.MeshStandardMaterial();
    m.map = tex(g?.pbrMetallicRoughness?.baseColorTexture);
    m.normalMap = tex(g?.normalTexture);
    const mr = tex(g?.pbrMetallicRoughness?.metallicRoughnessTexture);
    m.roughnessMap = mr;
    m.metalnessMap = mr;
    m.emissiveMap = g?.emissiveTexture ? new THREE.Texture() : null;
    m.aoMap = g?.occlusionTexture ? new THREE.Texture() : null;
    m.side = g?.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
    if (g?.alphaMode === 'MASK') m.alphaTest = 0.5;
    if (g?.alphaMode === 'BLEND') m.transparent = true;
    m.vertexColors = colours;
    Object.assign(m.userData, g?.extras ?? {});
    if (m.userData.swgCube === true) registerReflective(m);
    return m;
  };
  const skinnedFiles = SKINNED.flatMap((f) => glbs(join(PACKS, f), []));
  const rackFiles = glbs(join(PACKS, 'weapons'), []);
  if (!skinnedFiles.length && !rackFiles.length) console.log(`skip the packs: no skinned model or weapon folder under ${PACKS}`);
  else {
    let primitives = 0;
    let outside = 0;
    let stale = 0;
    const before = new Set<string>();
    const after = new Set<string>();
    const byWhy = new Map<string, { n: number; file: string }>();
    // Every shape a stand-in compiles (they were normalised in section 6, as the world adopts them): an inside primitive
    // must be one of these, or the warm builds programs no person asks for and leaves the person's to be built in play.
    const standInKeys = new Set(signatureStandIns().map((s) => shapeKey(s.material as THREE.Material, factsOf(s))));
    const insideShapes = new Set<string>();
    let inside = 0;
    const unwarmed: string[] = [];
    let blended = 0;
    let blendedOutside = 0;
    // The Trandoshans' eyelids and the Mon Calamari's eye shine, blended by the converter's eye-film rule.
    const EYE_FILM = /\/(trn_[mf]_lid|mon_[mf]_eyetrans)\.sht$/;
    let films = 0;
    let filmsBlended = 0;
    const filmNotes: string[] = [];
    const count = (files: string[], kind: 'person' | 'rack'): void => {
      for (const file of files) {
        if (!isNamed(file)) {
          stale++;
          continue;
        }
        const j = glbJson(file);
        if (!j?.meshes) continue;
        const skinned = new Set<number>();
        for (const n of j.nodes ?? []) if (n.skin !== undefined && n.mesh !== undefined) skinned.add(n.mesh);
        j.meshes.forEach((mesh, mi) => {
          const isSkinned = skinned.has(mi);
          if (kind === 'person' && !isSkinned) return;
          for (const p of mesh.primitives ?? []) {
            primitives++;
            const targets = p.targets ?? [];
            const gm = p.material !== undefined ? j.materials?.[p.material] : undefined;
            const mat = materialOf(gm, p.attributes.COLOR_0 !== undefined);
            if (kind === 'rack') mat.userData.swgRack = true;
            // The mesh the loader would build, as far as the product reads it: its skinning, its morphs padded to the
            // rung (positions and normals as the targets carry them), its normals and tangents.
            const rung = morphRung(targets.length);
            const owner = {
              isSkinnedMesh: isSkinned,
              geometry: {
                morphAttributes: targets.length ? { position: new Array(rung), ...(targets.every((t) => t.NORMAL !== undefined) ? { normal: new Array(rung) } : {}), ...(targets.some((t) => t.COLOR_0 !== undefined) ? { color: new Array(rung) } : {}) } : {},
                getAttribute: (k: string) => (k === 'normal' ? (p.attributes.NORMAL !== undefined ? {} : undefined) : k === 'tangent' ? (p.attributes.TANGENT !== undefined ? {} : undefined) : undefined),
              },
            } as unknown as THREE.Object3D;
            const facts = factsOf(owner);
            before.add(shapeKey(mat, facts));
            normalisePerson(mat, owner);
            after.add(shapeKey(mat, facts));
            const why = outsideWhy(mat, facts, kind);
            // Outside, and named as blended, or as unlit where it is three's unlit kind (whose reading stops there: the
            // Jawa's eye is both).
            if (gm?.alphaMode === 'BLEND') {
              blended++;
              if (why.includes('blended') || why.join() === 'unlit') blendedOutside++;
            }
            // The species rigs' eye films; a mobile's own model wearing the same shader is the mobiles command's to blend
            // and is drawn as its pack has it (cut, inside the product, where it changes no pixel), noted only.
            if (kind === 'person' && gm?.name && EYE_FILM.test(gm.name)) {
              const rel = relative(PACKS, file);
              if (/^characters[\\/]/.test(rel)) {
                films++;
                if (why.includes('blended')) filmsBlended++;
              } else if (gm.alphaMode !== 'BLEND') filmNotes.push(rel);
            }
            if (why.length) {
              outside++;
              const k = `${kind}: ${why.join(', ')}`;
              const e = byWhy.get(k) ?? { n: 0, file: relative(PACKS, file) };
              e.n++;
              byWhy.set(k, e);
            } else {
              inside++;
              const key = shapeKey(mat, facts);
              insideShapes.add(key);
              if (!standInKeys.has(key) && unwarmed.length < 4) unwarmed.push(`${relative(PACKS, file)}: ${key}`);
            }
          }
        });
      }
    };
    count(skinnedFiles, 'person');
    count(rackFiles, 'rack');
    console.log(`     ${primitives} primitives over ${skinnedFiles.length + rackFiles.length - stale} models a pack names (${stale} files no pack names left out): ${before.size} shapes as converted, ${after.size} once normalised; ${outside} outside the product`);
    for (const [why, e] of [...byWhy].sort((x, y) => y[1].n - x[1].n)) console.log(`       ${String(e.n).padStart(5)}  ${why}   e.g. ${e.file}`);
    ok(primitives > 0, 'the packs hold skinned and rack primitives to count');
    ok(inside > 0 && unwarmed.length === 0, `every primitive inside the product (${inside} in ${insideShapes.size} shapes) has a stand-in of its own shape, so the warm builds the very programs it asks for${unwarmed.length ? `: not ${unwarmed.join('; ')}` : ''}`);
    ok(blendedOutside === blended,`every blended primitive is outside the product, named as blended (or as unlit, three's unlit kind) (${blendedOutside} of ${blended}), never forced into an opaque shape`);
    if (films) ok(filmsBlended === films, `the species rigs' eye films (the Trandoshans' lids, the Mon Calamari's eye shine) are among them (${filmsBlended} of ${films})`);
    else console.log('     no eye film in these packs (no Trandoshan or Mon Calamari rig converted)');
    if (filmNotes.length) console.log(`     note: ${filmNotes.length} eye film(s) on a mobile's own model are not blended in its pack (the mobiles command's to blend; drawn cut, as the pack has them): ${filmNotes.join(', ')}`);
  }
}

console.log(`\npersonKeys: ${checks} checks passed`);
