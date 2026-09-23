// Reading three's program cache key (src/core/fx/programCensus.ts): finding the fixed run of
// parameters in a key whose head (defines) and tail (a material's own key) are both any length,
// reading the light counts and the boolean masks out of it, and grouping a world's programs so
// that a family with more than one says what the second one is for.
//
// Every key here is built by this file the way three builds one (WebGLPrograms.getProgramCacheKey:
// the shader id, the defines in pairs, forty-eight parameters, two masks, the colour space, the
// material's own key), so the test pins the reading and not the game. Nothing is read from the
// client's files and no renderer is made.
import assert from 'node:assert/strict';
import { LIGHT_FIELDS, anchorOf, census, combinedLights, lightSignature, marksOf, namesOfDifference, readKey, type Census, type LightCounts } from '../../../src/core/fx/programCensus.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

type KeyParts = {
  shaderId?: string;
  customIds?: [number, number];
  defines?: [string, string][];
  lights?: Partial<LightCounts>;
  maskA?: number;
  maskB?: number;
  toneMapping?: number;
  cubeUV?: string;
  custom?: string;
  channels?: (string | undefined)[];
};

/**
 * A cache key built exactly as three joins one, so the reader is tested against the real shape.
 *
 * Every field here is written the way three 0.185 writes it, which is not always the way it reads:
 * a map's UV set is the word `false` where the material has no such map (`HAS_MAP && getChannel(…)`)
 * and the name of a channel where it has one, `envMapMode` is `false` with no environment, and
 * `morphAttributeCount` is never set at all and so comes out as nothing. Guessing these was what
 * made an earlier reader find no anchor in any key a running world held. `REAL_KEY` below is one
 * the game itself built, kept as the check on all of it.
 */
function makeKey(p: KeyParts): string {
  const a: unknown[] = [];
  if (p.shaderId) a.push(p.shaderId);
  else a.push(...(p.customIds ?? [4, 5]));
  for (const [name, value] of p.defines ?? []) a.push(name, value);
  a.push('highp'); // precision
  a.push('srgb-linear'); // outputColorSpace
  a.push(false); // envMapMode: false with no environment
  a.push(p.cubeUV); // envMapCubeUVHeight: unset unless a filtered cube is bound
  for (let i = 0; i < 23; i++) a.push(p.channels?.[i] ?? false); // every texture's uv set, or false
  a.push(undefined); // combine
  a.push(false, false); // fogExp2, sizeAttenuation
  a.push(0, undefined); // morphTargetsCount, morphAttributeCount (never set)
  for (const f of LIGHT_FIELDS) a.push(p.lights?.[f] ?? 0);
  a.push(1); // shadowMapType
  a.push(p.toneMapping ?? 0);
  a.push(0, 0); // numClippingPlanes, numClipIntersection
  a.push(0); // depthPacking
  a.push(p.maskA ?? 0, p.maskB ?? 0);
  a.push('srgb-linear'); // the renderer's output colour space, pushed again
  a.push(p.custom ?? '');
  return a.join();
}

/**
 * One key the running game really built, taken from a world with the effects on: a shader material
 * of the effects chain (two custom ids rather than a shader id, no defines, no lights, the ACES
 * tone mapping, and an empty compile hook as its own key). Nothing in it names anything of the
 * client's -- a cache key holds three's parameters and the hook's source, never a model or a
 * texture. It is here so that a three that changes the shape of its keys fails this file rather
 * than quietly reporting a world of two hundred programs as unreadable.
 */
const REAL_KEY = '5,6,highp,srgb,false,,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,,false,false,0,,0,0,0,0,0,0,0,0,0,0,0,1,4,0,0,0,0,0,srgb,onBeforeCompile() {}';

const bit = (names: readonly string[], ...want: string[]): number => {
  let m = 0;
  names.forEach((n, i) => {
    if (want.includes(n)) m |= 1 << i;
  });
  return m;
};
const MASK_A_NAMES = ['instancing', 'instancingColor', 'instancingMorph', 'matcap', 'envMap', 'normalMapObjectSpace', 'normalMapTangentSpace', 'clearcoat', 'iridescence', 'alphaTest', 'vertexColors', 'vertexAlphas', 'vertexUv1s', 'vertexUv2s', 'vertexUv3s', 'vertexTangents', 'anisotropy', 'alphaHash', 'batching', 'dispersion', 'batchingColor', 'gradientMap', 'packedNormalMap', 'vertexNormals'];
const MASK_B_NAMES = ['fog', 'useFog', 'flatShading', 'logarithmicDepth', 'reversedDepth', 'skinning', 'morphTargets', 'morphNormals', 'morphColors', 'premultipliedAlpha', 'shadowMapEnabled', 'doubleSided', 'flipSided', 'useDepthPacking', 'dithering', 'transmission', 'sheen', 'opaque', 'pointsUvs', 'decodeVideoTexture', 'decodeVideoTextureEmissive', 'alphaToCoverage', 'lightProbeGrids', 'hasPositionAttribute'];

// The two light sets the game's own passes have: the world (the cascades, the fill, the flash
// pool, a hemisphere and the torch) and a building's rooms (its parallel light and its lamps).
const WORLD_LIGHTS: Partial<LightCounts> = { dir: 4, point: 4, spot: 1, hemi: 1, dirShadow: 3, spotShadow: 1 };
const ROOM_LIGHTS: Partial<LightCounts> = { dir: 1, point: 12 };
// What a camera that sees every layer at once has: the two sets added together.
const BOTH_LIGHTS: Partial<LightCounts> = { dir: 5, point: 12, spot: 1, hemi: 1, dirShadow: 3, spotShadow: 1 };

// The source of a compile hook, which three puts at the tail of the key verbatim: commas,
// newlines, and the word this reader anchors on, all in one token run.
const HOOK_SOURCE = 'function wetObject(shader, renderer) { const a = "highp float x, y;"; previous.call(this, shader, renderer); }';

// ---------------------------------------------------------------------------------------------
// Finding the fixed run.
{
  const plain = makeKey({ shaderId: 'standard', lights: WORLD_LIGHTS });
  ok(anchorOf(plain.split(',')) === 1, 'with no defines the run starts right after the shader id');

  const csm = makeKey({ shaderId: 'standard', defines: [['USE_CSM', '1'], ['CSM_CASCADES', '3'], ['CSM_FADE', '']], lights: WORLD_LIGHTS });
  ok(anchorOf(csm.split(',')) === 7, 'the defines are stepped over, however many there are');

  const trap = makeKey({ shaderId: 'standard', defines: [['SOME_PRECISION', 'highp']], lights: WORLD_LIGHTS });
  ok(anchorOf(trap.split(',')) === 3, 'a define whose value is a precision is not mistaken for the run');

  const tail = makeKey({ shaderId: 'standard', lights: WORLD_LIGHTS, custom: HOOK_SOURCE });
  ok(anchorOf(tail.split(',')) === 1, 'and neither is the word inside a compile hook at the tail');

  ok(anchorOf('nothing,like,a,key'.split(',')) === -1, 'a key that is not one reads as unread rather than as anything');
  ok(readKey('nothing,like,a,key') === null, 'and readKey says so');

  // The shapes, against a key the game itself built rather than against this file's idea of one.
  const real = readKey(REAL_KEY)!;
  ok(real !== null, 'a key the running game built is read');
  ok(real.shaderId === 'custom' && real.defines.length === 0, 'its two custom ids are not read as a define');
  ok(lightSignature(real.lights) === 'no lights', 'a pass drawn with no lights says so');
  ok(real.toneMapping === '4' && real.custom === 'onBeforeCompile() {}', 'the tone mapping and the material’s own key are where three puts them');
}

// ---------------------------------------------------------------------------------------------
// Reading one key.
{
  const read = readKey(makeKey({
    shaderId: 'standard',
    defines: [['USE_CSM', '1'], ['CSM_CASCADES', '3']],
    lights: WORLD_LIGHTS,
    maskA: bit(MASK_A_NAMES, 'alphaTest', 'vertexColors'),
    maskB: bit(MASK_B_NAMES, 'fog', 'useFog', 'shadowMapEnabled', 'skinning'),
    custom: `wet-object|${HOOK_SOURCE}`,
  }))!;
  ok(read.shaderId === 'standard', 'the shader id is the head of the key');
  ok(read.defines.length === 2 && read.defines[0].name === 'USE_CSM' && read.defines[1].value === '3', 'the defines come back in pairs, in order');
  ok(read.lights.dir === 4 && read.lights.point === 4 && read.lights.spot === 1 && read.lights.hemi === 1, 'the light counts are read where three put them');
  ok(read.lights.dirShadow === 3 && read.lights.spotShadow === 1 && read.lights.pointShadow === 0, 'and so are the shadow counts');
  ok(read.flags.includes('alphaTest') && read.flags.includes('vertexColors'), 'the first mask is read bit by bit');
  ok(read.flags.includes('fog') && read.flags.includes('skinning') && read.flags.includes('shadowMapEnabled'), 'and so is the second');
  ok(!read.flags.includes('doubleSided') && !read.flags.includes('instancing'), 'a bit that is not set is not named');
  ok(read.customKind === 'wet', 'the wetness wrap is named from the material\'s own key');
  ok(read.custom.includes('previous.call'), 'and the hook\'s whole source is kept, commas and all');
  ok(marksOf(read).includes('cascades') && marksOf(read).includes('wet'), 'the marks name the cascades and the wrap');

  const shaderMaterial = readKey(makeKey({ customIds: [11, 12], lights: ROOM_LIGHTS }))!;
  ok(shaderMaterial.shaderId === 'custom', 'a shader material with no shader id reads as custom');
  ok(shaderMaterial.defines.length === 0, 'and its two ids are not mistaken for a define');
  ok(lightSignature(shaderMaterial.lights) === '1 dir, 12 point', 'the light signature is the counts that are not nought');
  ok(lightSignature(readKey(makeKey({ shaderId: 'sprite' }))!.lights) === 'no lights', 'a pass with no lights says so');
}

// ---------------------------------------------------------------------------------------------
// What differs between two keys of one family. This is the whole point: a family with two
// programs has to say which token made the second one, or there is nothing to cut.
{
  const worldPass = makeKey({ shaderId: 'basic', lights: WORLD_LIGHTS });
  const roomPass = makeKey({ shaderId: 'basic', lights: ROOM_LIGHTS });
  const bothPass = makeKey({ shaderId: 'basic', lights: BOTH_LIGHTS });
  const differ = namesOfDifference([worldPass, roomPass]);
  ok(differ.some((d) => d.startsWith('lights (dir)')) && differ.some((d) => d.startsWith('lights (point)')), 'two passes with different lights differ by their lights and nothing else');
  ok(differ.every((d) => d.startsWith('lights')), 'and by nothing else at all');

  const sided = namesOfDifference([worldPass, makeKey({ shaderId: 'basic', lights: WORLD_LIGHTS, maskB: bit(MASK_B_NAMES, 'doubleSided') })]);
  ok(sided.length === 1 && sided[0] === 'doubleSided', 'a material that differs only by its side says so by name');

  const defined = namesOfDifference([worldPass, makeKey({ shaderId: 'basic', defines: [['USE_CSM', '1']], lights: WORLD_LIGHTS })]);
  ok(defined.includes('defines'), 'a different set of defines is named as such, and the rest is still lined up');
  ok(!defined.some((d) => d.startsWith('token')), 'lining the keys up on the run means nothing after the defines reads as different');

  const owned = namesOfDifference([worldPass, makeKey({ shaderId: 'basic', lights: WORLD_LIGHTS, custom: `wet-object|${HOOK_SOURCE}` })]);
  ok(owned.length === 1 && owned[0] === 'own key', 'a material that only wears the wetness wrap differs by its own key');

  const cube = namesOfDifference([makeKey({ shaderId: 'standard', lights: WORLD_LIGHTS, cubeUV: '256' }), makeKey({ shaderId: 'standard', lights: WORLD_LIGHTS, cubeUV: '512' })]);
  ok(cube.length === 1 && cube[0] === 'envMapCubeUVHeight', 'and a reflection filtered at another height says that, which is a cut nobody may make');

  // The third light set is what a camera seeing every layer at once builds, and it is a whole
  // extra program for every material drawn under it.
  const three = census([
    { id: 1, name: 'hull', cacheKey: worldPass, usedTimes: 3 },
    { id: 2, name: 'hull', cacheKey: roomPass, usedTimes: 3 },
    { id: 3, name: 'hull', cacheKey: bothPass, usedTimes: 3 },
  ]);
  ok(three.programs === 3 && three.groups.length === 1 && three.groups[0].programs === 3, 'one material family with three light sets is three programs');
  ok(three.byLight.length === 3, 'each light set is counted on its own');
  ok(three.split === 1, 'and the family is reported as split');
  ok(three.groups[0].variants.every((v) => v.used === 3), 'how many materials share each program is carried through');

  // The rule that finds it: a light set that is two of the others added together is one camera
  // shown both, which is no pass the game draws.
  ok(three.combined.length === 1 && three.combinedPrograms === 1, 'the third light set is named as one that holds both of the others');
  ok(three.combined[0].of.includes(lightSignature(readKey(worldPass)!.lights)) && three.combined[0].of.includes(lightSignature(readKey(roomPass)!.lights)), 'and it says which two');

  const twoPasses = census([
    { id: 1, name: 'hull', cacheKey: worldPass },
    { id: 2, name: 'hull', cacheKey: roomPass },
  ]);
  ok(twoPasses.combined.length === 0, 'the two passes on their own hold nothing but themselves and are left alone');
}

// ---------------------------------------------------------------------------------------------
// The sum rule on its own, where the arithmetic can be stated outright.
{
  const set = (lights: Partial<LightCounts>, programs: number): { lights: string; counts: LightCounts; programs: number } => {
    const counts = {} as LightCounts;
    for (const f of LIGHT_FIELDS) counts[f] = lights[f] ?? 0;
    return { lights: lightSignature(counts), counts, programs };
  };
  const world = set(WORLD_LIGHTS, 60);
  const rooms = set(ROOM_LIGHTS, 63);
  const both = set(BOTH_LIGHTS, 13);
  const none = set({}, 75);

  const found = combinedLights([none, world, rooms, both]);
  ok(found.length === 1 && found[0].programs === 13, 'the set that holds both of the game’s passes is found, with what it cost');
  ok(found[0].of.includes(world.lights) && found[0].of.includes(rooms.lights), 'and it names the two passes it holds');
  ok(combinedLights([none, world, rooms]).length === 0, 'and with that set gone nothing is reported at all');
  ok(combinedLights([none, world]).length === 0, 'a set with no lights at all is never taken as one of the two');

  // The point lights are one pool everything borrows from, so the set a camera sees with both
  // passes at once holds twelve of them rather than the world's four and the rooms' twelve added.
  ok(both.counts.point === rooms.counts.point, 'the pooled lights are not counted twice');

  // A pass and a smaller view of the same pass are not two passes: the bigger one covers the
  // smaller, and nothing is reported.
  const fewer = set({ dir: 4, point: 2, spot: 1, hemi: 1, dirShadow: 3, spotShadow: 1 }, 5);
  ok(combinedLights([world, fewer, both]).length === 0, 'a set that covers one pass and a smaller view of it is left alone');

  const near = set({ dir: 5, point: 12, spot: 1, hemi: 1, dirShadow: 2, spotShadow: 1 }, 9);
  ok(combinedLights([world, rooms, near]).length === 0, 'a set that is close but does not hold all of both is left alone');
}

// ---------------------------------------------------------------------------------------------
// The census over a world: families, order and the unread count.
{
  const rows = [
    { id: 1, name: '', type: 'MeshStandardMaterial', cacheKey: makeKey({ shaderId: 'standard', lights: WORLD_LIGHTS }), usedTimes: 40 },
    { id: 2, name: '', type: 'MeshStandardMaterial', cacheKey: makeKey({ shaderId: 'standard', lights: ROOM_LIGHTS }), usedTimes: 12 },
    { id: 3, name: 'glow', type: 'SpriteMaterial', cacheKey: makeKey({ shaderId: 'sprite', lights: WORLD_LIGHTS }), usedTimes: 2 },
    { id: 4, type: 'RawShaderMaterial', cacheKey: 'not a key at all' },
  ];
  const c = census(rows);
  ok(c.programs === 4 && c.unread === 1, 'every program is counted and the unreadable one is counted apart');
  ok(c.groups[0].label === 'MeshStandardMaterial' && c.groups[0].programs === 2, 'families are named by the material and the biggest comes first');
  ok(c.groups[0].used === 52, 'and how many materials share the family is the sum of its programs');
  ok(c.groups.find((g) => g.label === 'glow')?.programs === 1, 'a material with a name of its own is grouped under it');
  ok(c.byLight[0].programs === 2 && c.byLight[0].lights.startsWith('4 dir'), 'the light signatures are counted, most first');
  ok(c.groups.find((g) => g.label === 'RawShaderMaterial')?.variants[0].lights === 'unread', 'an unread key is still listed rather than dropped');
}

// ---------------------------------------------------------------------------------------------
// What the console hook takes and what it reads out. The census is of no use as a node test alone
// -- the question it answers is asked of a running world -- so the one shape the game hands it is
// pinned here: the renderer's own live list, which is a readonly array of rows whose ids and names
// may be missing, and the two fields `__debug.shaders()` reads off the answer whether or not the
// family list was asked for.
{
  const rows: readonly { id?: number; name?: string; cacheKey: string }[] = [
    { id: 1, name: 'hull', cacheKey: makeKey({ shaderId: 'standard', lights: WORLD_LIGHTS }) },
    { id: 2, name: 'hull', cacheKey: makeKey({ shaderId: 'standard', lights: ROOM_LIGHTS }) },
    { id: 3, name: 'hull', cacheKey: makeKey({ shaderId: 'standard', lights: BOTH_LIGHTS }) },
  ];
  const live: Census = census(rows);
  ok(live.programs === 3, 'the census reads the renderer\'s own list without copying it');
  ok(live.combinedPrograms === 1 && live.combined[0].of.length === 2, 'the guard rail is readable from it: the set holding two passes at once, and which two');
  ok(live.split === 1 && live.groups[0].label === 'hull', 'and the family that has more than one program is named');
  ok(census([]).combinedPrograms === 0 && census([]).groups.length === 0, 'an empty list answers nought rather than throwing');
}

console.log(`\n${checks} checks passed`);
