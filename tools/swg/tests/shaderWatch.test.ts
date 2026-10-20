// What the game knows about its own shader programs (src/core/shaderWatch.ts).
//
// Four things are pinned here, and none of them needs a GPU or a browser.
//
//  1. Three's program cache key, in two halves that have to agree. The key is a comma-joined array
//     whose head (a shader id and the defines) and tail (the material's own key) are both any
//     length, so the module finds the fixed run in the middle by anchoring on the precision and
//     checking that every field of the run is something three could have written there. That check
//     is only as good as what it believes three writes, and the first cut of this file believed
//     wrongly: it expected the word `undefined` in an unset field and so read none of a real
//     world's 222 keys while every test here passed. So the order is read out of three's own
//     `WebGLPrograms.js`, what an unset field looks like is read out of it as well, and the reader
//     is then driven on keys **captured from the running game** rather than only on keys this file
//     made up.
//  2. The watch itself: that a steady frame does no work and allocates nothing it can avoid, that a
//     frame which made one program and dropped another is caught (the renderer's own count would
//     show that frame as quiet), and that a key built twice is counted as built twice.
//  3. The machine probe: that each throw-away program carries a source nobody has used before, that
//     the blocking query is really made **and its answer really read** (a link the driver refuses
//     comes back at once, and timed without being read it would call the sickest driver the fastest
//     machine going), that everything built is deleted again, that a quick first answer stops the
//     probe there, and that the probe refuses to run in play.
//  4. What is said about the machine: the console's one line, the loading screen's, the settings
//     page's, and that a machine with nothing wrong with it is told nothing at all.
//
// The captured keys aside, everything here is synthetic. Nothing is read from the client's files.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const {
  ProgramWatch,
  SHADER_TUNE,
  backendOf,
  checkDriver,
  classifyCompiler,
  compilerVerdict,
  driverCheck,
  forgetCompilerMeasurement,
  groupPrograms,
  lightWords,
  loadingLine,
  machineAside,
  middleOf,
  noteProgramTime,
  pacingHard,
  probeCompiler,
  programLabel,
  programMs,
  readKey,
  shaderBudget,
  verdictFrom,
  verdictLine,
  verdictNote,
} = await import('../../../src/core/shaderWatch.ts');

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// ---------------------------------------------------------------------------------------------
// 1. Three's own key order.
//
// The module anchors on the precision and counts forward, so what matters is the order of the 51
// fields from there and that exactly two boolean masks and the renderer's colour space come after
// them, with the material's own custom key last.
const here = dirname(fileURLToPath(import.meta.url));
const programsJs = readFileSync(join(here, '../../../node_modules/three/src/renderers/webgl/WebGLPrograms.js'), 'utf8');

function bodyOf(name: string): string {
  const at = programsJs.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `three still has ${name}`);
  const end = programsJs.indexOf('\n\t}\n', at);
  return programsJs.slice(at, end < 0 ? programsJs.length : end);
}

const pushed = (body: string): string[] => [...body.matchAll(/array\.push\(\s*parameters\.([A-Za-z0-9_]+)\s*\)/g)].map((m) => m[1]);

// The fixed run, in three's own order, as the module counts it back from the end.
const EXPECTED_TAIL = [
  'precision', 'outputColorSpace', 'envMapMode', 'envMapCubeUVHeight',
  'mapUv', 'alphaMapUv', 'lightMapUv', 'aoMapUv', 'bumpMapUv', 'normalMapUv', 'displacementMapUv',
  'emissiveMapUv', 'metalnessMapUv', 'roughnessMapUv', 'anisotropyMapUv', 'clearcoatMapUv',
  'clearcoatNormalMapUv', 'clearcoatRoughnessMapUv', 'iridescenceMapUv', 'iridescenceThicknessMapUv',
  'sheenColorMapUv', 'sheenRoughnessMapUv', 'specularMapUv', 'specularColorMapUv',
  'specularIntensityMapUv', 'transmissionMapUv', 'thicknessMapUv',
  'combine', 'fogExp2', 'sizeAttenuation', 'morphTargetsCount', 'morphAttributeCount',
  'numDirLights', 'numPointLights', 'numSpotLights', 'numSpotLightMaps', 'numHemiLights',
  'numRectAreaLights', 'numDirLightShadows', 'numPointLightShadows', 'numSpotLightShadows',
  'numSpotLightShadowsWithMaps', 'numLightProbes', 'shadowMapType', 'toneMapping',
  'numClippingPlanes', 'numClipIntersection', 'depthPacking',
];

{
  const params = pushed(bodyOf('getProgramCacheKeyParameters'));
  assert.deepEqual(params, EXPECTED_TAIL);
  ok(true, `three still writes its ${params.length} cache-key parameters in the order this reads them back`);
  const booleans = bodyOf('getProgramCacheKeyBooleans');
  const masks = [...booleans.matchAll(/array\.push\(\s*_programLayers\.mask\s*\)/g)].length;
  ok(masks === 2, `and still writes exactly two boolean masks after them (${masks})`);
  const key = bodyOf('getProgramCacheKey');
  ok(/array\.push\(\s*renderer\.outputColorSpace\s*\)/.test(key), "with the renderer's own colour space after the masks");
  ok(/array\.push\(\s*parameters\.customProgramCacheKey\s*\)/.test(key) && key.lastIndexOf('customProgramCacheKey') > key.lastIndexOf('outputColorSpace'), "and the material's own key last of all");
  // The head, which is where the defines are read from: one shader name, or two ids of the
  // material's own, and then each define as a name and a value. Which of the two it opens with is
  // read off the head's first field rather than off the head's length, so a define whose value
  // carries a comma cannot flip the answer.
  ok(/array\.push\(\s*parameters\.shaderID\s*\)/.test(key) && /array\.push\(\s*parameters\.customVertexShaderID\s*\)[\s\S]{0,120}?array\.push\(\s*parameters\.customFragmentShaderID\s*\)/.test(key), 'the key opens with one shader name, or with the two ids of a material carrying its own shaders');
  ok(/for\s*\(\s*const name in parameters\.defines\s*\)[\s\S]{0,160}?array\.push\(\s*name\s*\)[\s\S]{0,80}?array\.push\(\s*parameters\.defines\[ name \]\s*\)/.test(key), 'and then every define as a name and then its value, both into the same array');
  const shaderCacheJs = readFileSync(join(here, '../../../node_modules/three/src/renderers/webgl/WebGLShaderCache.js'), 'utf8');
  ok(/let _id = 0;/.test(shaderCacheJs) && /this\.id\s*=\s*_id\s*\+\+/.test(shaderCacheJs), "and those two ids are plain numbers, which a shader's name can never be and a define's name never is either — which is what makes the head's first field a safe way to tell one from two");
  // The bit each boolean sits on: the module names a handful of them, and every one must still be
  // where it was, or a double-sided material would read as alpha-tested.
  const bitOf = (body: string, name: string, which: 0 | 1): number => {
    const halves = body.split(/array\.push\(\s*_programLayers\.mask\s*\)/);
    const m = halves[which].match(new RegExp(`parameters\\.${name}\\b[\\s\\S]{0,60}?_programLayers\\.enable\\(\\s*(\\d+)\\s*\\)`));
    return m ? Number(m[1]) : -1;
  };
  ok(bitOf(booleans, 'instancing', 0) === 0 && bitOf(booleans, 'envMap', 0) === 4 && bitOf(booleans, 'alphaTest', 0) === 9 && bitOf(booleans, 'vertexColors', 0) === 10, 'the first mask still carries instancing, environment maps, the alpha test and vertex colours where this reads them');
  ok(bitOf(booleans, 'fog', 1) === 0 && bitOf(booleans, 'skinning', 1) === 5 && bitOf(booleans, 'shadowMapEnabled', 1) === 10 && bitOf(booleans, 'doubleSided', 1) === 11 && bitOf(booleans, 'flipSided', 1) === 12, 'and the second still carries fog, skinning, the shadow maps and which face is drawn');
}

// What three writes into a field that is not set, which is what the reader's anchor has to believe.
// `array.join()` writes an empty string for undefined and null, and three's own parameters are
// mostly not numbers: a map's UV set is `HAS_MAP && getChannel(...)`, so an absent map writes the
// word `false` and a present one writes `uv`, `uv1` … This is the half of the key the first cut of
// this file got wrong, and it is read out of three rather than believed.
{
  const params = programsJs.slice(programsJs.indexOf('function getParameters('));
  ok(/mapUv:\s*HAS_MAP\s*&&\s*getChannel\(/.test(params), "a map's UV set is a channel name only when there is such a map, and the word false when there is not");
  ok(/function getChannel\(\s*value\s*\)\s*\{[\s\S]{0,200}?return 'uv'[\s\S]{0,120}?return `uv\$\{ value \}`/.test(programsJs), 'and the channel names are uv, uv1, uv2 … as this reads them');
  ok(/envMapMode:\s*HAS_ENVMAP\s*&&\s*envMap\.mapping/.test(params), "the environment map's kind is false when there is none");
  ok(/fogExp2:\s*\(\s*!!\s*fog\s*&&\s*fog\.isFogExp2\s*\)/.test(params) && /sizeAttenuation:\s*material\.sizeAttenuation === true/.test(params), 'the fog kind and the point sizing are always one of the two words');
  ok(!/\bmorphAttributeCount\s*:/.test(params), 'three pushes morphAttributeCount and never sets it, so that field is always empty — a reader that wants a number there reads nothing at all');
  ok(/combine:\s*material\.combine/.test(params), 'and how an environment map is combined is unset on every material that has none');
}

// ---------------------------------------------------------------------------------------------
// A key built the way three builds one, so the reader can be driven without a GPU.
interface FakeKey {
  head?: string[];
  defines?: Record<string, string>;
  dir?: number;
  point?: number;
  spot?: number;
  hemi?: number;
  dirShadow?: number;
  pointShadow?: number;
  spotShadow?: number;
  mask1?: number;
  mask2?: number;
  envHeight?: string;
  custom?: string;
  clipping?: number;
}

/**
 * A key built the way three really builds one: `array.join()`, with `false` where a map or an
 * environment map is absent, an empty field where a parameter is unset, and numbers only where
 * three has a number. Every value here was checked against keys taken off the running game (see
 * CAPTURED below).
 */
function makeKey(o: FakeKey = {}): string {
  const a: (string | number)[] = [...(o.head ?? ['physical'])];
  for (const [k, v] of Object.entries(o.defines ?? {})) a.push(k, v);
  // precision, the material's colour space, the environment map's kind and its cube height.
  a.push('highp', 'srgb-linear', 'false', o.envHeight ?? '');
  for (let i = 0; i < 23; i++) a.push('false'); // the per-map UV sets: false where there is no such map
  a.push('', 'false', 'false', 0, ''); // combine, fogExp2, sizeAttenuation, morphTargetsCount, morphAttributeCount
  a.push(o.dir ?? 0, o.point ?? 0, o.spot ?? 0, 0, o.hemi ?? 0, 0);
  a.push(o.dirShadow ?? 0, o.pointShadow ?? 0, o.spotShadow ?? 0, 0, 0);
  a.push(1, 4, o.clipping ?? 0, 0, 0); // shadowMapType, toneMapping, clipping, clipIntersection, depthPacking
  a.push(o.mask1 ?? 0, o.mask2 ?? 0);
  a.push('srgb', o.custom ?? DEFAULT_KEY);
  return a.join();
}

/** What a material that added nothing of its own writes: the source of three's empty hook. */
const DEFAULT_KEY = 'onBeforeCompile() {}';

/**
 * The shape that made the first cut of this reader wrong: three's own default
 * `customProgramCacheKey` is `this.onBeforeCompile.toString()`, so a material with a hook — which
 * in this game is nearly all of them, the shadow cascades putting one on and the wet wrap another —
 * ends its key with the hook's whole source text, commas and newlines and all.
 */
const A_HOOK = "function (shader) {\n  shader.uniforms.wetness = { value: 0 };\n  shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', 'gl_FragColor.rgb = mix(a, b, w);');\n}";

// The two light signatures the design warms, in the design's own words.
const WORLD_PASS = { dir: 4, point: 4, dirShadow: 1, spotShadow: 3 };
const ROOM_PASS = { dir: 1, point: 12 };

{
  const facts = readKey(makeKey(WORLD_PASS))!;
  ok(!!facts, 'a key built the way three builds one is read');
  ok(facts.lights === '4 dir, 4 point, 1 dirShadow, 3 spotShadows', `and its lights come out in the design's own words ("${facts.lights}")`);
  ok(readKey(makeKey(ROOM_PASS))!.lights === '1 dir, 12 point', 'the rooms\' own signature reads back as well');
  ok(facts.side === 'front' && !facts.skinning && !facts.fog, 'a key with both masks clear has no flag set');
  const flags = readKey(makeKey({ ...WORLD_PASS, mask1: (1 << 9) | (1 << 10), mask2: (1 << 0) | (1 << 5) | (1 << 11) }))!;
  ok(flags.alphaTest && flags.vertexColors && flags.fog && flags.skinning && flags.side === 'double', 'and the bits this reads are the ones three sets');
  ok(readKey(makeKey({ mask2: 1 << 12 }))!.side === 'back', 'a flipped face reads as the back');
  ok(readKey(makeKey({ envHeight: '1024', mask1: 1 << 4 }))!.envHeight === '1024', "the environment cube's height is kept, since it is in the program key and a change of it recompiles");
  ok(readKey(makeKey({ defines: { USE_CSM: '1', CSM_CASCADES: '3' } }))!.cascades, "the shadow cascades' define is found among the defines, wherever they sit");
  ok(readKey(makeKey({ custom: 'wet-object|swg-ground-wet-16' }))!.wet, 'and the wet wrap by the front of the key the material wrote itself');
  ok(readKey(makeKey({ custom: 'swg-ground-tiles-wet' }))!.wet, "and the ground drawn the client's way, which carries the wet look itself, by its own key");
  ok(readKey(makeKey({ custom: 'undefined' }))!.custom === '', 'a material with no key of its own reports none rather than the word undefined');
  ok(readKey(makeKey({ custom: DEFAULT_KEY }))!.custom === '' && readKey(makeKey({ custom: DEFAULT_KEY }))!.customLength === 0, "and three's own empty hook, which nearly every material writes, is no key of its own either");
  ok(readKey(makeKey({ clipping: 6 }))!.clipping === 6, 'the clipping planes are read');
  ok(readKey(makeKey({ defines: { USE_CSM: '1', TERRAIN_FAMILIES: '16' } }))!.defines.join(' ') === 'USE_CSM TERRAIN_FAMILIES', "every define's name is read off the head of the key, which is this game's own");
  // A material carrying its own two shaders opens the key with two ids instead of one name, so the
  // defines start one field later. Counting from the wrong one reads each value as a name.
  const twoIds = readKey(makeKey({ head: ['3', '4'], defines: { VEL_ALPHA: '' }, ...ROOM_PASS }))!;
  ok(twoIds.defines.join(' ') === 'VEL_ALPHA', `a material with its own two shaders still has its defines read ("${twoIds.defines.join(' ')}")`);
  ok(twoIds.pointLights === 12, 'and the rest of its key with them');
  // And a define whose VALUE carries a comma, which three joins into the same array as everything
  // else: `vec2(1,2)` is one value to three and two fields afterwards, so the names and values are
  // one field out of step from there on. Read by the head's length and its parity, as this was, the
  // whole list came back counted from the wrong end — `['', 'vec2(1']` where four defines stood.
  const commaed = readKey(makeKey({ ...ROOM_PASS, defines: { STANDARD: '', SOME_DEF: 'vec2(1,2)', LATER_DEF: '1' } }))!;
  ok(!!commaed && commaed.pointLights === 12, "a define whose value carries a comma does not stop the rest of the key being read");
  ok(commaed.defines.join(' ') === 'STANDARD SOME_DEF LATER_DEF', `and every define is still named, the one with the comma included ("${commaed.defines.join(' ')}")`);
  const commaedTwo = readKey(makeKey({ head: ['37', '38'], defines: { A: 'vec2(1,2)', B: '' }, ...ROOM_PASS }))!;
  ok(commaedTwo.defines.join(' ') === 'A B', `on a material with its own two shaders as well, where the length and the parity say the opposite of the truth ("${commaedTwo.defines.join(' ')}")`);
  ok(readKey(makeKey({ defines: { USE_CSM: '1', SOME_DEF: 'vec2(1,2)' } }))!.cascades, "and the cascades' own define is found past one");
  // The masks are bit fields, not counts: every real key in the game carries one of 8388608 or more,
  // and a reader that bounds them like a light count reads no key at all.
  const big = readKey(makeKey({ mask1: 8388608 | (1 << 9), mask2: 8388608 | (1 << 0) }));
  ok(!!big && big.alphaTest && big.fog, `a mask well past a million is read as the bit field it is (${8388608 | (1 << 9)})`);
}

// The shape the first cut of this got wrong: a key that ends in a hook's source text.
{
  const hooked = readKey(makeKey({ ...WORLD_PASS, custom: A_HOOK }));
  ok(!!hooked, "a key whose last field is a hook's source — commas, newlines and all — is still read");
  ok(hooked!.lights === '4 dir, 4 point, 1 dirShadow, 3 spotShadows', 'with its lights right, which counting back from the end of the key could never be');
  ok(hooked!.customLength === A_HOOK.length, `and the material's own key measured whole (${hooked!.customLength} characters)`);
  ok(hooked!.custom.length <= 60 && hooked!.custom.endsWith('…') && !hooked!.custom.includes('\n'), `while what is shown of it is one short line ("${hooked!.custom}")`);
  const wetHook = readKey(makeKey({ ...ROOM_PASS, custom: `wet-object|${A_HOOK}` }));
  ok(wetHook!.wet && wetHook!.pointLights === 12, 'and the wet wrap is still found at the front of one');
}

// ---------------------------------------------------------------------------------------------
// Keys taken off the running game, verbatim.
//
// These are the ones that matter: a key this file made up can only ever agree with what this file
// believes, and what it believed at first was wrong in two ways at once — an unset field is empty
// or the word `false`, never `undefined`, and the two masks are bit fields running past eight
// million, which a reader that bounds them like a light count refuses. With both mistakes in place
// every check above still passed while the game read 0 of its 222 keys. So four keys are copied
// here as the renderer handed them over on a planet: the ground, a room's prop, a shadow pass and
// the one material in a world whose key cannot be read at all.
//
// They are cache keys and nothing else: three builds them out of its own parameters, the defines
// and the material's own key, so no name of anything converted appears in one.
const CAPTURED = {
  /** The ground: the cascades' defines, the world's lights, and its own wet key at the end. */
  ground: 'physical,STANDARD,,USE_CSM,1,CSM_CASCADES,3,CSM_FADE,,highp,srgb-linear,false,,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,,true,false,0,,4,4,1,0,1,0,3,0,0,0,0,1,0,0,0,0,8388608,8520707,srgb,swg-ground-wet-17',
  /** A prop inside a building: the room pass's lights, instanced, with maps on three channels. */
  prop: 'physical,STANDARD,,highp,srgb-linear,false,,uv,false,false,false,false,uv,false,uv,uv,uv,false,false,false,false,false,false,false,false,false,false,false,false,false,,true,false,0,,1,12,0,0,0,0,0,0,0,0,0,1,0,0,0,0,8388673,8519683,srgb,onBeforeCompile() {}',
  /** A shadow pass: depth packing is a real number there, and the alpha test is on. */
  depth: 'depth,highp,srgb-linear,false,,uv,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,,false,false,0,,1,12,0,0,0,0,0,0,0,0,0,1,0,0,0,3200,8389121,8530944,srgb,onBeforeCompile() {}',
  /** The effects' output pass, a raw shader material: three writes no run of parameters at all. */
  raw: '37,38,SRGB_TRANSFER,,ACES_FILMIC_TONE_MAPPING,,onBeforeCompile() {}',
};

{
  const ground = readKey(CAPTURED.ground)!;
  ok(!!ground, "the ground's own key, as the renderer handed it over, is read");
  ok(ground.lights === '4 dir, 4 point, 1 spot, 1 hemi, 3 dirShadows', `and its lights are the world pass's ("${ground.lights}")`);
  ok(ground.cascades && ground.wet && ground.fog, 'with the cascades, the wet wrap and the fog all found');
  ok(ground.defines.join(' ') === 'STANDARD USE_CSM CSM_CASCADES CSM_FADE', `and every define named ("${ground.defines.join(' ')}")`);
  ok(ground.custom === 'swg-ground-wet-17', "and the material's own key kept whole, since that is what the ground is keyed by");

  const prop = readKey(CAPTURED.prop)!;
  ok(prop.lights === '1 dir, 12 point', "a prop in a room reads as the room pass, which is the other signature the game warms");
  ok(prop.instancing && prop.fog && !prop.cascades && !prop.wet, 'instanced, fogged, with no cascades and no wet wrap');
  ok(prop.custom === '' && prop.customLength === 0, "and no key of its own, though three wrote its empty hook there");

  const depth = readKey(CAPTURED.depth)!;
  ok(depth.alphaTest && depth.instancing && depth.side === 'double', 'a shadow pass reads its alpha test, its instancing and which face it draws');
  ok(!depth.fog, 'and carries no fog, as a depth material does not');

  ok(readKey(CAPTURED.raw) === null, 'while a raw shader material, which three writes no parameters for at all, is reported unread rather than guessed at');
}

// A key this cannot read is said to be unread rather than guessed at.
{
  ok(readKey('too,short') === null, 'a key shorter than the fixed run is refused');
  ok(readKey(makeKey({ head: ['raw'] }).replace('highp', 'weird')) === null, 'so is one with no precision word in it at all, which is the anchor the run is found by');
  // The anchor is searched for rather than counted to, so a stray precision word in a define or in a
  // hook's source must not take the reader with it.
  const decoy = readKey(makeKey({ ...ROOM_PASS, defines: { PRECISION: 'highp' }, custom: `precision highp float; ${A_HOOK}` }));
  ok(!!decoy && decoy.pointLights === 12, 'and a precision word inside a define or a hook is stepped over rather than read as the start of the run');
}

{
  ok(lightWords(0, 0, 0, 0, 0, 0, 0) === 'no lights', 'a program with no lights says so');
  ok(lightWords(0, 1, 0, 0, 0, 1, 0) === '1 point, 1 pointShadow', 'and one shadow is singular');
}

// ---------------------------------------------------------------------------------------------
// 2. The watch.
let nextId = 1;
const row = (key: string, name = '', type = 'MeshStandardMaterial'): { id: number; name: string; cacheKey: string; type: string } => ({ id: nextId++, name, cacheKey: key, type });

{
  const watch = new ProgramWatch();
  const world = row(makeKey(WORLD_PASS));
  const room = row(makeKey(ROOM_PASS));
  const live = [world, room];
  const first = watch.sample(live, 'loading', 100);
  ok(first.made === 2 && first.dropped === 0 && first.live === 2, 'the first sample counts everything the renderer holds');
  ok(first.walked, 'and does the full comparison, since it has nothing to compare against');
  ok(first.first.includes('4 dir, 4 point'), `and names the first of them in words ("${first.first}")`);

  const steady = watch.sample(live, 'play', 116);
  ok(steady.made === 0 && steady.dropped === 0, 'a frame that changed nothing makes and drops nothing');
  ok(!steady.walked, 'and takes the cheap way out rather than walking the list: one pass for the highest id and no set touched');
  ok(watch.sample(live, 'play', 132) === steady, 'the result is one object filled in place, so a frame allocates nothing for it');

  // The frame the renderer's own count cannot see: one made, one dropped, the length unchanged.
  const swapped = [world, row(makeKey({ dir: 5, point: 12 }))];
  const churn = watch.sample(swapped, 'play', 148);
  ok(churn.made === 1 && churn.dropped === 1 && churn.live === 2, 'a frame that made one and dropped one is caught, which the renderer\'s own count would report as quiet');
  ok(churn.first.includes('5 dir, 12 point'), 'and names what was made');
  // The phase each key was built in, which `__debug.personKeys().inPlay` reads a material's own programs by.
  ok(watch.phaseOf(world.cacheKey) === 'loading' && watch.phaseOf(swapped[1].cacheKey) === 'play', 'a key answers the phase it was built in (`phaseOf`): behind the screen, or in play');
  ok(watch.phaseOf('a key no sample ever held') === null, 'and one the history does not hold answers null, never a phase');

  // A key asked for again after its program went is the expensive mistake, and is counted apart.
  watch.sample([world, row(makeKey(ROOM_PASS))], 'play', 164);
  const remade = watch.remade();
  ok(remade.length === 1 && remade[0].made === 2, `a key built twice is listed as built twice (${remade.length} such key)`);
  ok(remade[0].label.includes('1 dir, 12 point'), 'named by what it is rather than by its key');

  const totals = watch.totals;
  ok(totals.made === 4 && totals.dropped === 2, `the session's totals add up (${totals.made} made, ${totals.dropped} dropped)`);
  ok(totals.byPhase.loading === 2 && totals.byPhase.play === 2, 'and are kept apart by what the game was doing, since only the ones built in play are stalls the player sees');
  ok(watch.builtInPlay().length === 2, 'what was built in play is listed on its own');
  const since = watch.takeSince();
  ok(since === 4 && watch.takeSince() === 0, 'and "what has been built since I last asked" answers once and then resets');
}

// The per-key history is capped. Nothing tells the watch when the renderer lets a program go, and
// the key it is holding is usually the whole source text of the material's hook — kilobytes of it —
// so an evening of travelling between worlds would otherwise keep every key it ever saw, and the
// two hooks that walk the map would slow down with the length of the session rather than with the
// live list.
{
  const watch = new ProgramWatch();
  const over = 40;
  const keyAt = (n: number): string => makeKey({ ...ROOM_PASS, custom: `own-key-${n}` });
  for (let i = 0; i < SHADER_TUNE.historyMax + over; i++) watch.sample([row(keyAt(i))], 'loading', i);
  const t = watch.totals;
  ok(t.made === SHADER_TUNE.historyMax + over, `every program built is still counted, however many there have been (${t.made})`);
  ok(t.keys === SHADER_TUNE.historyMax, `while the history itself stops at the cap (${t.keys} keys)`);
  ok(t.forgotten === over, `and says how many it has forgotten rather than being quietly short (${t.forgotten})`);
  // What is kept is the most recently built. Asking for the newest key again is the remake it is;
  // the oldest is gone and would read as a first build.
  watch.sample([row(keyAt(SHADER_TUNE.historyMax + over - 1))], 'play', 1e6);
  const remade = watch.remade();
  ok(remade.length === 1 && remade[0].made === 2, 'the newest keys are the ones kept, so a program asked for straight back is still seen as a remake');
  const inPlay = watch.builtInPlay();
  ok(inPlay.length === 1 && inPlay[0].at === 1e6, 'and a key first built behind a loading screen but asked for again in play is listed at the moment it cost a live frame, not at the one it was first built');
}

// A program that goes and never comes back is a drop and nothing more.
{
  const watch = new ProgramWatch();
  const a = row(makeKey(WORLD_PASS));
  const b = row(makeKey(ROOM_PASS));
  watch.sample([a, b], 'loading', 0);
  const gone = watch.sample([a], 'play', 16);
  ok(gone.made === 0 && gone.dropped === 1, 'a program let go is a drop with nothing made');
  ok(watch.remade().length === 0, 'and is not a remake until something asks for it again');
}

// ---------------------------------------------------------------------------------------------
// Grouping the live list: the figure to have before anything is collapsed.
{
  const rows = [
    row(makeKey(WORLD_PASS)),
    row(makeKey(WORLD_PASS)),
    row(makeKey({ ...WORLD_PASS, mask2: 1 << 11 })),
    row(makeKey(ROOM_PASS)),
    row(makeKey({ dir: 5, point: 12 })),
    row('not,a,key,this,reads'),
  ];
  const g = groupPrograms(rows);
  ok(g.live === 6 && g.read === 5 && g.unread === 1, 'every live program is counted, and the ones whose key could not be read are counted apart rather than dropped');
  const lights = g.groups.lights;
  ok(lights[0].name === '4 dir, 4 point, 1 dirShadow, 3 spotShadows' && lights[0].count === 3, 'the commonest light signature leads the list');
  ok(lights.some((l) => l.name === '5 dir, 12 point' && l.count === 1), 'and a signature with one program in it — a pass nothing warmed — stands out');
  ok(g.groups.side.find((s) => s.name === 'double')?.count === 1, 'the faces are counted, since two programs differing only by which face is drawn are worth chasing');
  ok(g.groups.lights.find((l) => l.name === 'key not read')?.count === 1, 'and an unread key is named as such rather than counted as no lights');
}

{
  const label = programLabel({ id: 1, name: '', cacheKey: makeKey({ ...ROOM_PASS, mask2: 1 << 5 }), type: 'MeshPhongMaterial' }, readKey(makeKey({ ...ROOM_PASS, mask2: 1 << 5 })));
  ok(label.startsWith('MeshPhongMaterial') && label.includes('skinned'), `a program with no name of its own is named by its material and what makes it differ ("${label}")`);
  ok(programLabel({ id: 1, name: 'water', cacheKey: 'unreadable' }, null) === 'water', 'and an unreadable key still gives the name three had');
}

// ---------------------------------------------------------------------------------------------
// 3. The machine, and what is said about it.
{
  ok(classifyCompiler(0) === 'unknown' && classifyCompiler(-1) === 'unknown', 'nothing measured is unknown, never quick');
  ok(classifyCompiler(SHADER_TUNE.quickMs - 0.01) === 'quick', 'under the quick end is quick');
  ok(classifyCompiler(SHADER_TUNE.quickMs) === 'fair' && classifyCompiler(SHADER_TUNE.slowMs - 0.01) === 'fair', 'the band between is fair');
  ok(classifyCompiler(SHADER_TUNE.slowMs) === 'slow' && classifyCompiler(300) === 'slow', 'and a third of a second a program is slow');
  ok(middleOf([300, 9, 310]) === 300, 'the middle sample is taken, so one cached answer among three cannot call a slow machine fast');
  ok(middleOf([]) === 0, 'and no samples at all is nothing rather than a number');
  ok(middleOf([11]) === 11, 'one sample is itself');
  // An even number of samples has no middle sample of its own, and reaching for `sorted[n / 2]`
  // takes the LARGER of the two innermost — which on a pair is the outlier winning, the exact
  // opposite of what a median is here for. A pair is reachable: a probe that links, is refused and
  // links again has two. The measurement this defence was written for was a 121.7 ms first link on
  // a machine that did the same work in 7.5 ms twice straight afterwards.
  ok(middleOf([7.5, 121.7]) === (7.5 + 121.7) / 2, 'two samples take the middle between them');
  ok(middleOf([7.5, 121.7]) < 121.7 && middleOf([121.7, 7.5]) === middleOf([7.5, 121.7]), 'which is never simply the worse of the two, whichever order they came in');
  ok(middleOf([8, 9, 10, 300]) === 9.5, 'and four samples the same way');
}

{
  const slow = verdictFrom([305, 298, 311]);
  ok(slow.speed === 'slow' && slow.hard && slow.budget === SHADER_TUNE.playBudget, 'a slow machine is paced, and paced hard');
  ok(slow.msPerProgram === 305, `with the cost it measured (${slow.msPerProgram} ms)`);
  const quick = verdictFrom([0.4]);
  ok(quick.speed === 'quick' && !quick.hard, 'a quick one is not paced hard');
  ok(quick.budget === SHADER_TUNE.playBudget, 'though one a frame still holds, since it costs a quick machine nothing to obey');
  const none = verdictFrom([], 'no drawing context');
  ok(!none.measured && none.speed === 'unknown' && none.why === 'no drawing context', 'and an unmeasured machine says why rather than pretending to a number');
}

{
  const slow = verdictFrom([305]);
  const line = verdictLine(slow);
  ok(line.startsWith('shaders:') && line.includes('305 ms') && line.includes('freeze'), `the console's one line says the number and what it means ("${line}")`);
  ok(verdictLine(verdictFrom([0.4])).includes('nothing to work around'), 'and on a quick machine says there is nothing to work around');
  ok(!verdictLine(verdictFrom([])).includes('NaN'), 'an unmeasured machine still gets a sentence');
}

{
  // The loading screen's line counts the programs made behind it, never the objects the sweep walks (which fly
  // past once the sweep is sliced), and says what one costs here only past `quickMs`.
  ok(loadingLine(40, verdictFrom([0.4])) === 'building shaders, 40 new', 'on a quick machine the loading screen says how many programs it has made, and nothing more');
  ok(loadingLine(3, verdictFrom([])) === 'building shaders, 3 new', 'an unmeasured machine says nothing extra');
  ok(loadingLine(3, verdictFrom([SHADER_TUNE.quickMs - 0.1])) === 'building shaders, 3 new', 'nor does one just under quickMs');
  const slow = loadingLine(12, verdictFrom([305]));
  ok(slow === 'building shaders, 12 new · about 305 ms each here', `past quickMs it says what each costs here ("${slow}")`);
  ok(loadingLine(12, verdictFrom([SHADER_TUNE.quickMs])).includes(`${SHADER_TUNE.quickMs} ms each`), 'from quickMs itself');
  ok(!/objects/.test(slow), 'never the object count, which a per-program time beside it invites a player to multiply');
  // The number a player is given must be a number they cannot multiply into a wrong answer. The Effects
  // switch's notice still counts OBJECTS just before its aside, so the aside there names the shader program
  // itself and says that most of those objects share one already built.
  for (const v of [verdictFrom([305]), verdictFrom([25])]) {
    const aside = machineAside(v);
    ok(aside.includes('shader program') && !/each one/.test(aside), `the aside names the shader program rather than borrowing the objects the line counted ("${aside.trim()}")`);
    ok(aside.includes('share one already built'), 'and says that most of the objects counted share a program, so the two numbers are not multiplied together');
  }
  ok(machineAside(verdictFrom([0.4])) === '' && machineAside(verdictFrom([])) === '', 'a machine with nothing wrong with it is told nothing at all, on any screen');
}

{
  ok(verdictNote(verdictFrom([])) === '', 'the settings page says nothing at all until the machine has been measured');
  // The driver is blamed only where its own least trivial link is past slowMs: a real program costing 305 ms on a
  // healthy driver (Direct3D 11 builds the game's in about 400) is the backend's price, never the driver's fault.
  const healthy = verdictNote(verdictFrom([305], '', { leastMs: 0.4, queueMs: 300, samples: [0.4, 0.5, 0.6], tries: 3, done: true }));
  ok(healthy.includes('305 ms') && !healthy.includes('driver') && !healthy.includes('shaders:'), `a slow program on a healthy driver says its cost and blames nobody ("${healthy}")`);
  const broken = verdictNote(verdictFrom([305], '', { leastMs: 280, queueMs: 2, samples: [280, 300, 290], tries: 3, done: true }));
  ok(broken.includes('280 ms') && broken.includes('driver') && !broken.includes('shaders:'), 'a driver whose own trivial link is past slowMs is blamed, in the player\'s own words, not the console\'s');
  const brokenUnmeasured = verdictNote(verdictFrom([], '', { leastMs: SHADER_TUNE.slowMs, queueMs: 0, samples: [SHADER_TUNE.slowMs], tries: 1, done: false }));
  ok(brokenUnmeasured.includes('driver'), 'from slowMs itself, and even before the sweep has timed a real program');
  ok(verdictNote(verdictFrom([0.4])).includes('as it should be'), 'a quick machine is told it is fine');
  // The figures a player is shown are the ones the probe can stand behind: whole milliseconds above
  // ten, one decimal below, and never a trailing nought pretending to a fourth figure.
  ok(verdictNote(verdictFrom([7.5])).includes('7.5 ms') && !verdictNote(verdictFrom([7.5])).includes('7.50'), 'and is told it in the figures the measurement really has');
  ok(verdictLine(verdictFrom([305.4])).includes('305 ms') && machineAside(verdictFrom([61.44])).includes('61 ms'), 'while past ten milliseconds the decimals are dropped everywhere alike');
}

// ---------------------------------------------------------------------------------------------
// The probe. A stand-in for the drawing context counts everything the probe does to it.
function fakeGl(cost: number | number[], opts: { failCreate?: boolean; failLink?: true | number[] } = {}) {
  const costs = Array.isArray(cost) ? cost.slice() : [cost];
  let n = 0;
  const gl: any = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, LINK_STATUS: 3,
    sources: [] as string[], created: 0, deleted: 0, programs: 0, programsDeleted: 0, linked: 0, statusRead: 0, used: 0, bound: 0,
    createShader: () => (opts.failCreate ? null : (gl.created++, { id: gl.created })),
    createProgram: () => (opts.failCreate ? null : (gl.programs++, { id: gl.programs })),
    shaderSource: (_s: unknown, src: string) => gl.sources.push(src),
    compileShader: () => {},
    attachShader: () => {},
    detachShader: () => {},
    linkProgram: () => {
      gl.linked++;
      // The driver's work lands on the status query, which is where the probe times it; the clock
      // here is moved by the stand-in rather than by really waiting.
      const take = costs.length > 1 ? costs.shift()! : costs[0];
      gl.pending = take;
    },
    getProgramParameter: () => {
      gl.statusRead++;
      const take = gl.pending ?? 0;
      gl.pending = 0;
      const until = nowMs() + take;
      while (nowMs() < until) { /* the driver blocking, as it really does */ }
      // LINK_STATUS, which is a real answer and not only a delay: a driver that refuses the link
      // comes back at once, and a probe that timed that without reading it would file the refusal
      // as this machine's cost. `failLink` names which links are refused (all of them, or the
      // 1-based numbers of the ones that are).
      return !(opts.failLink === true || (Array.isArray(opts.failLink) && opts.failLink.includes(gl.linked)));
    },
    deleteShader: () => gl.deleted++,
    deleteProgram: () => gl.programsDeleted++,
    useProgram: () => gl.used++,
    bindBuffer: () => gl.bound++,
  };
  return gl;
}
const nowMs = (): number => Number(process.hrtime.bigint() / 1000n) / 1000;

{
  const gl = fakeGl(0);
  const samples = probeCompiler(gl, 12345);
  ok(samples.length === 1, 'a quick first answer stops the probe there, so a machine that needs none of this pays for one trivial link');
  ok(gl.linked === 1 && gl.statusRead === 1, 'the program is linked and the blocking status query really is made, which is where a slow driver spends its time');
  ok(gl.deleted === 2 && gl.programsDeleted === 1, 'and everything built is deleted again');
  ok(gl.used === 0 && gl.bound === 0, 'nothing is bound, used or drawn with, so the renderer\'s own state is untouched and needs no saving');
}

{
  const gl = fakeGl(SHADER_TUNE.quickMs + 4);
  const samples = probeCompiler(gl, 999, 3);
  ok(samples.length === SHADER_TUNE.probeMax, `a first answer that is not quick is checked ${SHADER_TUNE.probeMax} times over`);
  ok(new Set(gl.sources).size === gl.sources.length, 'and every probe carries a source nobody has used before, or the browser\'s own program cache would answer from disk and call a slow machine a fast one');
  ok(samples.every((s: number) => s >= SHADER_TUNE.quickMs), 'each sample is the time the blocking query really took');
}

{
  const gl = fakeGl(0, { failCreate: true });
  ok(probeCompiler(gl, 1).length === 0, 'a context that will not build a program is no samples rather than a throw');
}

// A link the driver refuses is no sample at all, and never a fast one. This is the failure that
// runs the wrong way: a refusal comes back in a fraction of a millisecond, and a probe that timed
// it without reading the answer would tell the very machine this file was written for — one whose
// driver is too sick to link four lines of GLSL — that it was the quickest one going, which is the
// one verdict that switches the pacing, the console line and the Interface note all off.
{
  const gl = fakeGl(0, { failLink: true });
  const samples = probeCompiler(gl, 4242, 3);
  ok(samples.length === 0, 'a link the driver refuses is no sample: a refusal is fast, and taken as a measurement it would call a broken driver the fastest machine going');
  ok(gl.statusRead === 3 && gl.programsDeleted === 3, 'the status is read on every try and everything built is still deleted');
  const v = verdictFrom(samples, 'the probe could not build a program');
  ok(!v.measured && v.speed === 'unknown', 'and a probe that never linked is unmeasured rather than quick');
}

// One refusal in the middle does not end the probe: the tries are still made, and what comes back
// is the links that really linked. Two samples is the case the middle has to have an answer for.
{
  const gl = fakeGl([SHADER_TUNE.quickMs + 4, 0, SHADER_TUNE.quickMs + 6], { failLink: [2] });
  const samples = probeCompiler(gl, 31337, 3);
  ok(gl.linked === 3, 'all three tries are made though one of them was refused');
  ok(samples.length === 2, `and the refusal is stepped over rather than ending the probe (${samples.length} samples)`);
  ok(classifyCompiler(middleOf(samples)) === 'fair', 'so a machine that answered twice is judged on the two answers it gave');
}

// ---------------------------------------------------------------------------------------------
// The one verdict the session keeps: the sweep's real programs decide the pacing, the driver check decides
// only whether the driver is blamed.
{
  forgetCompilerMeasurement();
  ok(!compilerVerdict().measured && shaderBudget() === SHADER_TUNE.playBudget && !pacingHard(), 'before anything is measured the pacing is already on and nothing is hard');
  ok(shaderBudget(true) === SHADER_TUNE.loadBudget, 'and a loading screen has a budget of its own, since the player is waiting on purpose');
  // `hard` follows the sweep's own milliseconds a program.
  noteProgramTime(3 * 9, 3);
  ok(compilerVerdict().measured && programMs() === 9 && !pacingHard(), 'a sweep that built three programs in 27 ms times them at 9 ms each, which is not hard');
  noteProgramTime(0, 0);
  ok(compilerVerdict().samples.length === 1, 'a batch that built nothing is no sample');
  forgetCompilerMeasurement();
  noteProgramTime(2 * 400, 2);
  noteProgramTime(410, 1);
  noteProgramTime(390, 1);
  ok(programMs() === 400 && pacingHard() && compilerVerdict().speed === 'slow', 'three batches at about 400 ms a program (Direct3D 11) make the pacing hard, by their median');
  ok(shaderBudget() === SHADER_TUNE.playBudget, 'which changes nothing in play: one a frame was already the rule');
  ok(shaderBudget(true) === SHADER_TUNE.hardLoadBudget && SHADER_TUNE.hardLoadBudget < SHADER_TUNE.loadBudget, 'and fewer behind a loading screen, so the line under the title keeps moving instead of standing still for seconds');
  forgetCompilerMeasurement();
  ok(!compilerVerdict().measured && !pacingHard(), 'and forgetting it (`shaders({ probe: \'again\' })`) leaves the next screen to measure afresh');
}

// The driver check. A stand-in context whose `getError` waits for the game's own queued work on its first call
// (300 ms, as the probe once timed straight after the game's draws), and whose links cost what each test says.
function drainingGl(linkMs: number, drainMs = 300) {
  const gl = fakeGl(linkMs);
  let drains = 0;
  gl.getError = () => {
    drains++;
    if (drains === 1) {
      const until = nowMs() + drainMs;
      while (nowMs() < until) { /* the game's own work finishing on the GPU */ }
    }
    return 0;
  };
  return gl;
}

{
  forgetCompilerMeasurement();
  const gl = drainingGl(0.3);
  const refused = checkDriver(gl as never, { inPlay: true });
  ok(refused.tries === 0 && !refused.done, 'the driver check never runs in play');
  ok(checkDriver(null).tries === 0, 'nor with no context');
  for (let i = 0; i < SHADER_TUNE.probeMax; i++) checkDriver(gl as never, { seed: 11 });
  const d = driverCheck();
  ok(d.done && d.tries === SHADER_TUNE.probeMax && d.samples.length === SHADER_TUNE.probeMax, `three tries, one a call (a call a frame in the game): ${d.tries}`);
  ok(d.queueMs >= 250 && d.queueMs < 1000, `the drain before the first link is timed apart as the game's own queued work (${d.queueMs} ms)`);
  ok(d.leastMs < SHADER_TUNE.quickMs, `and the links themselves are quick (${d.leastMs} ms), so a 300 ms queue is never blamed on the driver`);
  ok(!verdictNote(compilerVerdict()).includes('driver'), 'and the Interface page blames nobody');
  ok(checkDriver(gl as never).tries === SHADER_TUNE.probeMax, 'and once its tries are made it makes no more this session');
  forgetCompilerMeasurement();
}

{
  forgetCompilerMeasurement();
  const gl = drainingGl(SHADER_TUNE.slowMs + 240, 2);
  for (let i = 0; i < SHADER_TUNE.probeMax; i++) checkDriver(gl as never, { seed: 13 });
  const d = driverCheck();
  ok(d.leastMs >= SHADER_TUNE.slowMs, `a driver whose trivial links cost 300 ms is found slow (${d.leastMs} ms)`);
  ok(verdictNote(compilerVerdict()).includes('driver'), 'and only then does the Interface page blame the driver');
  ok(!pacingHard(), 'which decides nothing about the pacing: no real program has been timed');
  forgetCompilerMeasurement();
}

{
  // The least of spaced samples is kept: one slow neighbour cannot move a least.
  forgetCompilerMeasurement();
  const gl = drainingGl(0, 0);
  gl.linkProgram = () => {
    gl.linked++;
    gl.pending = gl.linked === 1 ? SHADER_TUNE.slowMs + 50 : 2;
  };
  for (let i = 0; i < SHADER_TUNE.probeMax; i++) checkDriver(gl as never, { seed: 17 });
  const d = driverCheck();
  ok(d.samples.length === 3 && d.leastMs < 10 && Math.max(...d.samples) >= SHADER_TUNE.slowMs, `the least of the spaced links is kept, a slow first one among them (${d.samples.join(', ')})`);
  ok(!verdictNote(compilerVerdict()).includes('driver'), 'so one slow link is never taken for a broken driver');
  forgetCompilerMeasurement();
}

{
  // A refused link is a try and no sample: a refusal is fast, and taken as a measurement it would call a broken
  // driver the fastest going.
  forgetCompilerMeasurement();
  const gl = fakeGl(0, { failLink: true });
  gl.getError = () => 0;
  for (let i = 0; i < SHADER_TUNE.probeMax; i++) checkDriver(gl as never, { seed: 19 });
  const d = driverCheck();
  ok(d.done && d.samples.length === 0 && d.leastMs === 0, 'a link the driver refuses is a try and no sample');
  forgetCompilerMeasurement();
}

// The backend, read once at boot off the renderer string.
{
  ok(backendOf('ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 (0x00002C02) Direct3D11 vs_5_0 ps_5_0, D3D11)') === 'd3d11', 'ANGLE on Direct3D 11 reads d3d11');
  ok(backendOf('ANGLE (NVIDIA, Vulkan 1.3.0 (NVIDIA GeForce RTX 5080 (0x00002C02)), NVIDIA)') === 'vulkan', 'ANGLE on Vulkan reads vulkan');
  ok(backendOf('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)') === 'software', 'SwiftShader reads software, whatever it runs on');
  ok(backendOf('ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)') === 'metal', 'ANGLE on Metal reads metal');
  ok(backendOf('ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)') === 'gl', 'ANGLE on OpenGL reads gl');
  ok(backendOf('') === 'unknown' && backendOf(null) === 'unknown', 'nothing to read is unknown');
}

console.log(`\n${checks} checks passed`);
