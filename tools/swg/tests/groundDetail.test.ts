// The ground up close (the horizon pass's wave 3b, `terrainTextures.ts`): the steep faces' side pictures and the relief
// near the eye in the near ground's tile program (and the side pictures in the rings' near look, through `TILE_MAP`).
// Held here: with both left out at load (the hatches, `swg.ground.tri` and `swg.ground.relief` '0'), the tile program
// assembled is 993f258's own assembled program to the byte, vertex and fragment, and its key with it; with them in, it adds
// no sampler, its new text calls nothing it does not define and declares nothing twice, the sides' share is nought at and
// under the start slope (so flat ground takes only the plain tap) as `groundMath.triSide` says, run from its own GLSL text,
// and the knobs move uniforms only. The pixels themselves are `groundSelfTest`'s (`ground({ selfTest })`'s upClose): flat
// ground drawn pixel for pixel as with both off, a turned face's stripe turned, the relief moving the picture near the eye.
//
// Run: node tools/swg/tests/groundDetail.test.ts
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { glslFunctionText, glslFunctions, GLSL_SCALARS } from './glslRun.ts';
import { redeclared, reservedWords, unbalanced, undeclaredNames, undefinedCalls } from './glslScan.ts';
import { loadOld } from './oldModules.ts';
import { triSide, triWeights, reliefOffset } from '../../../src/world/groundMath.ts';
import { GROUND_DECODE_GLSL, GROUND_DETAIL_TUNE, GROUND_MASK_GLSL, GROUND_RELIEF_GLSL, GROUND_TILES_KEY, GROUND_TRI_GLSL, TILE_MAP, TILE_RELIEF, injectGroundTiles, makeGroundTileUniforms, tileMapText, tuneGroundDetail, writeGroundDetail } from '../../../src/world/terrainTextures.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const BASE = '993f258';

const assemble = (m: { injectGroundTiles: typeof injectGroundTiles; makeGroundTileUniforms: typeof makeGroundTileUniforms }) => {
  const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} as Record<string, unknown> };
  const went = m.injectGroundTiles(shader, m.makeGroundTileUniforms());
  return { went, vertex: shader.vertexShader, fragment: shader.fragmentShader };
};

// ---- day one: both left out at load is the program of before, to the byte
const old = await loadOld<Record<string, unknown>>(['src/world/terrainTextures.ts'], 'src/world/terrainTextures.ts', BASE);
// Today's module again, read under a page whose storage holds both hatches (a fresh instance: the hatches are read at load).
const store = globalThis as unknown as { localStorage?: { getItem(k: string): string | null } };
const had = store.localStorage;
store.localStorage = { getItem: (k: string) => (k === 'swg.ground.tri' || k === 'swg.ground.relief' ? '0' : null) };
const hatched = (await import(`../../../src/world/terrainTextures.ts?hatched=${Date.now()}`)) as typeof import('../../../src/world/terrainTextures.ts');
if (had) store.localStorage = had;
else delete store.localStorage;
ok(!hatched.GROUND_TRI_WANTED && !hatched.GROUND_RELIEF_WANTED, 'the hatches are read at load: a page holding both leaves both out');
if (!old) console.log(`note git cannot show ${BASE} here: the day-one program check is left out`);
else {
  const before = assemble(old as never);
  const after = assemble(hatched);
  ok(before.went && after.went, `both tile programs go into three's standard shader (${BASE}'s and today's with both hatched)`);
  ok(after.vertex === before.vertex, `with both left out at load the tile program's vertex text is ${BASE}'s to the byte`);
  ok(after.fragment === before.fragment, `and its fragment text is ${BASE}'s to the byte`);
  ok(hatched.TILE_MAP === (old.TILE_MAP as string) && tileMapText(false, false) === (old.TILE_MAP as string), `TILE_MAP with both left out is ${BASE}'s to the byte`);
  ok(hatched.GROUND_TILES_KEY === (old.GROUND_TILES_KEY as string) && GROUND_TILES_KEY === (old.GROUND_TILES_KEY as string), `and the program's key is the one before (${GROUND_TILES_KEY}): one text a session, chosen at load`);
}

// ---- with both in (the defaults)
const now = assemble({ injectGroundTiles, makeGroundTileUniforms });
ok(now.went, 'the tile program with the side pictures and the relief goes into three\'s standard shader, every anchor found');
const samplers = (s: string) => [...s.matchAll(/uniform\s+(?:highp\s+)?\w*sampler\w+\s+(\w+)/g)].map((m) => m[1]).sort().join(',');
ok(samplers(now.fragment) === samplers(assemble(hatched).fragment), `and declares no sampler the program of before has not (${samplers(now.fragment)})`);
ok(TILE_MAP === tileMapText(true, true) && TILE_MAP.includes('groundTap( uGround, gUV, vGroundLayers.x, gDx, gDy )') && TILE_MAP.includes('vec2 gUV = vGroundUV + gGroundOff;'), 'TILE_MAP takes every picture through the side taps, at the relief\'s moved place');
ok(now.fragment.indexOf(TILE_RELIEF) >= 0 && now.fragment.indexOf(TILE_RELIEF) < now.fragment.indexOf(TILE_MAP), 'the relief is worked out before the composition, in the tile program alone');
// The new text scanned as a compiler would (three's own declarations stood in, the masks' and decode's functions beside it).
const scanned = `uniform mat4 viewMatrix;\nuniform vec4 uGroundTri;\nuniform vec4 uGroundRelief;\nuniform vec4 uGroundLook;\nuniform vec4 uGroundFrame;\nprecision highp sampler2DArray;\nuniform sampler2DArray uGround;\nuniform sampler2DArray uGroundBump;\nuniform sampler2DArray uGroundMask;\nvarying vec3 vViewPosition;\nvarying vec3 vNormal;\nflat varying vec4 vGroundLayers;\nflat varying vec4 vGroundBlend;\nvarying vec2 vGroundTile;\nvarying vec2 vGroundUV;\nvarying vec3 vGroundTint;\nvarying float vGroundY;\nvec3 gGroundW = vec3( 0.0 );\nvec4 gGroundBump = vec4( 0.0 );\nvec3 gGroundAlbedo = vec3( 1.0 );\nvec2 gGroundOff = vec2( 0.0 );\n${GROUND_MASK_GLSL}\n${GROUND_TRI_GLSL}\n${GROUND_RELIEF_GLSL}\n${GROUND_DECODE_GLSL}\nvoid main() {\n\tvec4 diffuseColor = vec4( 1.0 );\n${TILE_RELIEF}\n${TILE_MAP}\n}`;
const calls = undefinedCalls(scanned);
ok(calls.length === 0, `the side pictures' and the relief's text calls nothing it does not define (${calls.join(', ') || 'none'})`);
ok(redeclared(scanned).length === 0 && reservedWords(scanned).length === 0 && !unbalanced(scanned), 'and declares no name twice in one scope, uses no reserved word and balances its brackets');
const unknown = undeclaredNames(scanned);
ok(unknown.length === 0, `and reads no name the program round it does not declare (${unknown.join(', ') || 'none'})`);
// The relief loop: a fixed four steps, never a loop by distance.
ok(/for \( int i = 0; i < 4; i\+\+ \)/.test(GROUND_RELIEF_GLSL) && (GROUND_RELIEF_GLSL.match(/for \(/g) ?? []).length === 1, 'the relief steps a fixed four times, never by distance');
// Derivatives only where every pixel of the quad runs: none in the shared functions.
ok(!/dFd[xy]/.test(GROUND_TRI_GLSL + GROUND_RELIEF_GLSL), 'the side taps and the relief take no derivative of their own (each is handed them)');

// ---- the sides' share, run from its own GLSL text against the mirror
const G = glslFunctions(glslFunctionText(GROUND_TRI_GLSL, 'groundTriSide'), ['groundTriSide'], { ...GLSL_SCALARS });
let bad = 0;
let flatOff = 0;
for (let k = 0; k < 5000; k++) {
  const from = 5 + Math.random() * 60;
  const to = from + 1 + Math.random() * 25;
  const flatUp = Math.cos((from * Math.PI) / 180);
  const steepUp = Math.cos((to * Math.PI) / 180);
  const up = Math.random();
  const g = G.groundTriSide(up, flatUp, steepUp);
  if (Math.abs(g - triSide(up, flatUp, steepUp)) > 1e-12) bad++;
  if (up >= flatUp && g !== 0) flatOff++;
}
ok(bad === 0, 'groundTriSide run from its GLSL text is groundMath.triSide on 5,000 faces');
ok(flatOff === 0, "a face at or under the start slope gives the sides nought, exactly: the plain tap alone, the ground of before");
// The weights: the plain one whole under the slope, the three summing to one, the sides by the face's lean.
const wv: [number, number, number] = [0, 0, 0];
triWeights(0.05, 1, 0.02, Math.cos((40 * Math.PI) / 180), Math.cos((60 * Math.PI) / 180), 4, wv);
const flatW = wv.join();
triWeights(1, 0.1, 0, Math.cos((40 * Math.PI) / 180), Math.cos((60 * Math.PI) / 180), 4, wv);
ok(flatW === '1,0,0' && wv[0] === 0 && Math.abs(wv[1] - 1) < 1e-12 && wv[2] === 0, 'a gentle face takes the plain picture whole; a cliff looking along x takes the side along z whole');
triWeights(0.6, 0.3, 0.6, Math.cos((40 * Math.PI) / 180), Math.cos((60 * Math.PI) / 180), 4, wv);
ok(Math.abs(wv[0] + wv[1] + wv[2] - 1) < 1e-12 && Math.abs(wv[1] - wv[2]) < 1e-12, 'a face leaning both ways shares the sides evenly and the three sum to one');
// The relief's offset (one layer's mirror): toward the eye for a raised picture, nought on level ground and with no depth.
const ro: [number, number] = [0, 0];
reliefOffset(0, 0, 1, 1, 0, 1, 0.1, () => 0.5, ro);
const level = ro.join();
reliefOffset(0, 0, 1, 1, 0, 1, 0, () => 1, ro);
const none = ro.join();
reliefOffset(0, 0, 1, 1, 0, 1, 0.1, () => 1, ro);
ok(level === '0,0' && none === '0,0' && ro[0] < 0 && ro[1] === 0, "the relief moves nothing on a level picture or at no depth, and a raised picture toward an eye along +x moves along the picture's -u (the terrain's x runs the other way)");

// ---- the knobs: uniforms only, held inside their sense
const u = makeGroundTileUniforms();
const saved = JSON.stringify(GROUND_DETAIL_TUNE);
const said = tuneGroundDetail({ tri: { from: 50, to: 45, sharp: 999, bogus: 1 }, relief: false });
writeGroundDetail(u);
ok(said.some((s) => s.includes('bogus')) && GROUND_DETAIL_TUNE.tri.sharp === 32 && GROUND_DETAIL_TUNE.relief.on === false, 'the console takes the knobs by name, held inside their sense, and says what it will not take');
ok(u.uGroundTri.value.y > u.uGroundTri.value.z && Math.abs(u.uGroundTri.value.y - Math.cos((45 * Math.PI) / 180)) < 1e-12 && u.uGroundRelief.value.x === 0 && u.uGroundRelief.value.w === 0, 'from and to taken either way round (the gentler is where it starts), and the relief off writes no depth');
Object.assign(GROUND_DETAIL_TUNE.tri, JSON.parse(saved).tri);
Object.assign(GROUND_DETAIL_TUNE.relief, JSON.parse(saved).relief);

console.log(`\ngroundDetail: ${checks} checks passed`);
