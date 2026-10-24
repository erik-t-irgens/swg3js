// The tile ground's air variant as text (src/world/volumetrics/airGround.ts; the volumetrics design's §9 Tests): the
// variant over `THREE.ShaderLib.standard` after `injectGroundTiles` -- every anchor found and all eight `textureGrad`
// coordinates of the tile program's colour stage rewritten, or nothing written; a copy of the tile program with any one
// call changed, doubled or an anchor gone makes the rewrite write nothing; the samplers it adds are four; the derivatives
// and the tile masks never displaced; nothing the scanners refuse that the plain program has not already; the plain
// material's text and key unchanged (the commit before the pass holds them, `airOff.test.ts`); and the chooser's table
// (the master × the tile program × each switch × the field × the soft off).
//
// Node compiles no GLSL: `__debug.air({ groundSelfTest: true })` draws the variant in the browser. Plain type stripping.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GROUND_DECLS_END, GROUND_TILES_KEY, groundTilesMaterial, injectGroundTiles, makeGroundTileUniforms } from '../../../src/world/terrainTextures.ts';
import { AIR_GROUND_ANCHORS, copyAirGround, GROUND_AIR_KEY, groundAirMaterial, groundMaterialFor, groundWearsAir, injectGroundAir, makeAirGroundUniforms, swapGroundMaterial, TILE_SAMPLE_CALLS, type AirGroundUniforms, type GroundChoice } from '../../../src/world/volumetrics/airGround.ts';
import { glslVariant, redeclared, reservedWords, unbalanced, undefinedCalls, uniformNames } from './glslScan.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const count = (s: string, needle: string): number => s.split(needle).length - 1;

const airUniforms = (): AirGroundUniforms => ({
  uAirOffsets: { value: null },
  uAirDents: { value: null },
  uAirLayers: { value: null },
  uAirLight: { value: null },
  uAirWindow: { value: new THREE.Vector4() },
  uAirArt: { value: new THREE.Vector4() },
  uAirDentP: { value: new THREE.Vector4() },
  uAirDentQ: { value: new THREE.Vector4() },
  uAirShift: { value: new THREE.Vector4() },
  uAirMisc: { value: new THREE.Vector4() },
});
const standard = () => ({ vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} as Record<string, unknown> });

// --- the plain tile program, as `injectGroundTiles` writes it ---
const plain = standard();
ok(injectGroundTiles(plain, makeGroundTileUniforms()), 'the plain tile program goes into three\'s standard shader');
const plainFs = plain.fragmentShader;
ok(TILE_SAMPLE_CALLS.length === 8 && TILE_SAMPLE_CALLS.every((c) => count(plainFs, c) === 1), 'each of the eight colour and bump samples the variant rewrites is in the plain text exactly once');
ok(AIR_GROUND_ANCHORS.every((a) => plainFs.includes(a)), `and every anchor the variant writes at is there (${AIR_GROUND_ANCHORS.join(', ')})`);

// --- the variant ---
const air = airUniforms();
const v = { ...plain, uniforms: { ...plain.uniforms } };
ok(injectGroundAir(v, air), 'the variant goes in over it');
const fs = v.fragmentShader;
ok(v.vertexShader === plain.vertexShader, 'and touches no vertex text: no vertex moves and no varying is added');
ok(TILE_SAMPLE_CALLS.every((c) => !fs.includes(c)), 'none of the eight samples is left unshifted');
const layers = ['x', 'y', 'z', 'w'] as const;
const shifted = layers.flatMap((l) => ['uGround', 'uGroundBump'].map((t) => `textureGrad( ${t}, vec3( vGroundUV + gAirShift${l.toUpperCase()}, vGroundLayers.${l} ), gDx, gDy )`));
ok(shifted.every((c) => count(fs, c) === 1), 'each is sampled at its own layer\'s shift instead, exactly once, colour and bump alike');
ok(fs.includes('vec2 gDx = dFdx( vGroundUV );') && fs.includes('vec2 gDy = dFdy( vGroundUV );') && fs.includes('vec2 gTx = dFdx( vGroundTile );') && !/vGroundTile\s*\+/.test(fs), 'the derivatives are the undisplaced picture\'s and the tile masks are never displaced, so no mip level and no border moves');
{
  const common = fs.indexOf('#include <common>');
  const pars = fs.indexOf('uniform sampler2D uAirOffsets;');
  const declsEnd = fs.indexOf(GROUND_DECLS_END);
  ok(common >= 0 && pars > common && declsEnd > pars, 'its declarations sit after three\'s common chunk and the tile program\'s own, before the declarations\' end');
  const map = fs.indexOf('#include <map_fragment>');
  const block = fs.indexOf('if ( uAirArt.w > 0.5 ) {');
  const tileMap = fs.indexOf('vec2 gDx = dFdx( vGroundUV );');
  ok(map >= 0 && block > map && tileMap > block, 'its shifts are worked out after the map chunk and before the tile program\'s colour stage samples them');
  const normalMaps = fs.indexOf('#include <normal_fragment_maps>');
  const bend = fs.indexOf('if ( gAirDentSlope.x != 0.0 || gAirDentSlope.y != 0.0 ) {');
  const tileNormal = fs.indexOf('vec3 gn = gGroundBump.xyz * 2.0 - 1.0;');
  ok(normalMaps >= 0 && bend > normalMaps && tileNormal > bend, 'the dent\'s bend goes into the normal before the tile program adds the ground\'s own lean and bump to it');
  const lightsEnd = fs.indexOf('#include <lights_fragment_end>');
  const shade = fs.indexOf('if ( gAirShade < 1.0 ) {');
  const opaque = fs.indexOf('#include <opaque_fragment>');
  ok(lightsEnd >= 0 && shade > lightsEnd && opaque > shade, 'the dust\'s shadow comes off the direct light once the lights are summed, before the light leaves');
}
ok(/if \( uAirArt\.x != 0\.0 \) \{/.test(fs) && /if \( uAirArt\.y != 0\.0 \) \{/.test(fs) && /if \( uAirArt\.z != 0\.0 \) \{/.test(fs) && /if \( gAirShade < 1\.0 \) \{/.test(fs), 'every term is behind a uniform branch on its own dial: at nought the shift is nought and nothing else is touched');
ok(count(fs, 'airFinite') >= 6 && /texture\( uAirOffsets,[^;]*\)\.xy \) \* gAirIn/.test(fs), 'every field read is made finite before it is used, the offsets faded across the window\'s edge');
{
  const before = new Set(uniformNames(plainFs));
  const added = uniformNames(fs).filter((n) => !before.has(n));
  const samplers = added.filter((n) => new RegExp(`uniform\\s+sampler2D\\s+${n}\\s*;`).test(fs));
  ok(samplers.length === 4 && ['uAirOffsets', 'uAirDents', 'uAirLayers', 'uAirLight'].every((n) => samplers.includes(n)), `the samplers it adds are four (${samplers.join(', ')}): twelve of sixteen with the tile program's eight`);
  ok(added.length === Object.keys(air).length && added.every((n) => n in v.uniforms && (v.uniforms as Record<string, unknown>)[n] === (air as unknown as Record<string, unknown>)[n]), `every uniform it declares is on the shader, the very objects the field writes (${added.length})`);
  ok(uniformNames(fs).length === new Set(uniformNames(fs)).size, 'and none is declared twice');
}
// Nothing the scanners refuse that the plain program has not already (both read through the same variant of their #ifs).
{
  const defs = new Set<string>(['USE_MAP', 'USE_SHADOWMAP', 'USE_NORMALMAP']);
  const plainV = glslVariant(plainFs, defs);
  const varV = glslVariant(fs, defs);
  const fresh = (a: string[], b: string[]): string[] => b.filter((x) => !a.includes(x));
  const r = fresh(reservedWords(plainFs), reservedWords(fs));
  ok(r.length === 0, `no reserved word as a name that the plain program has not${r.length ? `: ${r.join(', ')}` : ''}`);
  // The scanner reads both branches of three's own #ifs as one body, so the plain text already counts one brace over;
  // what the variant adds must open exactly what it closes.
  const added = (ch: string): number => count(fs, ch) - count(plainFs, ch);
  ok(added('{') > 0 && added('{') === added('}') && added('(') === added(')') && unbalanced(plainFs) !== '', `what it adds balances its brackets (${added('{')} braces and ${added('(')} parentheses each way)`);
  const twice = fresh(redeclared(plainV), redeclared(varV));
  ok(twice.length === 0, `no name declared twice in one scope${twice.length ? `: ${twice.join(', ')}` : ''}`);
  // A call to a function the text never defines is the fault the pass's lesson is about (the dust pass called a
  // `finite4` it had not got and never linked): the plain text already calls three's chunk functions, which this scan
  // cannot see defined, so what counts is a call the variant adds.
  const calls = fresh(undefinedCalls(plainFs), undefinedCalls(fs));
  ok(calls.length === 0, `no call to a function it does not define that the plain program has not already${calls.length ? `: ${calls.join(', ')}` : ''}`);
  // And the scan can tell: a helper renamed where it is defined, and a built-in misspelt, are both named.
  const broken = fs.replace('float airEdge( const in vec2 q', 'float airEdgeOf( const in vec2 q').replace('texelFetch( uAirLayers', 'texelFetchh( uAirLayers');
  const caught = fresh(undefinedCalls(plainFs), undefinedCalls(broken));
  ok(broken !== fs && caught.includes('airEdge') && caught.includes('texelFetchh'), `the scan names a helper renamed at its definition and a misspelt built-in (${caught.join(', ')})`);
  ok(!/sampler2DShadow/.test(fs.slice(fs.indexOf('uniform sampler2D uAirOffsets;'), fs.indexOf(GROUND_DECLS_END))), 'no shadow compare of its own');
}

// --- all or nothing ---
{
  const tries: [string, string][] = [];
  for (const c of TILE_SAMPLE_CALLS) {
    tries.push([`a call changed (${c.slice(12, 60)}…)`, plainFs.replace(c, c.replace('vGroundUV,', 'vGroundUV * 1.0,'))]);
    tries.push([`a call doubled (${c.slice(12, 60)}…)`, plainFs.replace(GROUND_DECLS_END, `// ${c}\n${GROUND_DECLS_END}`)]);
  }
  for (const a of AIR_GROUND_ANCHORS) tries.push([`the anchor ${a} gone`, plainFs.split(a).join('')]);
  let all = true;
  const failed: string[] = [];
  for (const [name, text] of tries) {
    const s = { vertexShader: plain.vertexShader, fragmentShader: text, uniforms: {} as Record<string, unknown> };
    const done = injectGroundAir(s, airUniforms());
    if (done || s.fragmentShader !== text || Object.keys(s.uniforms).length !== 0) {
      all = false;
      failed.push(name);
    }
  }
  ok(all && tries.length === 8 * 2 + AIR_GROUND_ANCHORS.length, `over ${tries.length} copies of the tile program with one call changed or doubled or one anchor gone, the rewrite writes nothing and adds no uniform${failed.length ? ` (it wrote over: ${failed.join('; ')})` : ''}`);
}

// --- the materials ---
{
  const u = makeGroundTileUniforms();
  const plainMat = groundTilesMaterial(u, null);
  const variantMat = groundAirMaterial(u, air, null);
  ok(plainMat.customProgramCacheKey() === GROUND_TILES_KEY && GROUND_TILES_KEY === 'swg-ground-tiles-wet', `the plain material keeps its key (${GROUND_TILES_KEY})`);
  ok(variantMat.customProgramCacheKey() === GROUND_AIR_KEY && GROUND_AIR_KEY === `${GROUND_TILES_KEY}-air` && GROUND_AIR_KEY !== GROUND_TILES_KEY, `the variant's is its own (${GROUND_AIR_KEY}): two programs, the plain one's key never moved`);
  ok(variantMat.userData.wetBuiltIn === true && plainMat.userData.wetBuiltIn === true, 'both carry the weather built in, so the material scan wraps neither again');
  const sp = standard();
  plainMat.onBeforeCompile(sp as never, null as never);
  ok(sp.fragmentShader === plainFs && sp.vertexShader === plain.vertexShader, 'the plain material\'s hook writes the plain tile program and nothing of the air');
  const sv = standard();
  variantMat.onBeforeCompile(sv as never, null as never);
  ok(sv.fragmentShader === fs && sv.vertexShader === plain.vertexShader, 'the variant\'s hook writes the tile program and then the air over it, the same text as by hand');
  plainMat.dispose();
  variantMat.dispose();
  for (const t of [u.uGround.value, u.uGroundBump.value, u.uGroundMask.value, u.uGroundClouds.value]) t.dispose();
}

// --- the chooser ---
{
  const plainM = { which: 'plain' };
  const airM = { which: 'air' };
  let rows = 0;
  let right = true;
  for (let bits = 0; bits < 64; bits++) {
    const c: GroundChoice = { on: !!(bits & 1), tiles: !!(bits & 2), sand: !!(bits & 4), prints: !!(bits & 8), field: !!(bits & 16), softOff: !!(bits & 32) };
    const wants = c.on && c.tiles && c.field && (c.sand || c.prints) && !c.softOff;
    rows++;
    if (groundWearsAir(c) !== wants) right = false;
    if (groundMaterialFor(c, plainM, airM) !== (wants ? airM : plainM)) right = false;
    if (groundMaterialFor(c, plainM, null) !== plainM) right = false;
  }
  ok(right && rows === 64, `the chooser over all ${rows} rows: the variant only with the master, the tile program, the field and either ground switch and no soft off; the plain material by identity otherwise, and always when there is no variant`);
}

// --- the swap, on stand-ins: the world's own function (`World.syncGroundMaterial` hands it the chunks' groups and the far tiles) ---
{
  const plainMat = new THREE.MeshBasicMaterial();
  const variantMat = new THREE.MeshBasicMaterial();
  const other = new THREE.MeshBasicMaterial();
  const geo = new THREE.BufferGeometry();
  const chunk = (): { group: THREE.Group; meshes: THREE.Mesh[] } => {
    const group = new THREE.Group();
    // The ground, a skirt under it, and something else under the chunk's group that is not the ground (grass, say).
    const ground = new THREE.Mesh(geo, plainMat);
    const skirt = new THREE.Mesh(geo, plainMat);
    const grass = new THREE.Mesh(geo, other);
    const inner = new THREE.Group();
    inner.add(skirt);
    group.add(ground, inner, grass);
    return { group, meshes: [ground, skirt, grass] };
  };
  const chunks = [chunk(), chunk(), chunk()];
  const tiles = [new THREE.Mesh(geo, plainMat), new THREE.Mesh(geo, plainMat), new THREE.Mesh(geo, other)];
  const there = swapGroundMaterial(
    chunks.map((c) => c.group),
    tiles,
    plainMat,
    variantMat,
  );
  const grounds = chunks.flatMap((c) => c.meshes.slice(0, 2));
  ok(there === 8 && grounds.every((m) => m.material === variantMat) && tiles[0].material === variantMat && tiles[1].material === variantMat, `the variant goes on every chunk's ground, however deep under its group, and every far tile (${there} handed over)`);
  ok(chunks.every((c) => c.meshes[2].material === other) && tiles[2].material === other, 'and on nothing that was not wearing the plain ground');
  const back = swapGroundMaterial(
    chunks.map((c) => c.group),
    tiles.values(),
    variantMat,
    plainMat,
  );
  ok(back === 8 && grounds.every((m) => m.material === plainMat) && tiles[0].material === plainMat && chunks.every((c) => c.meshes[2].material === other), 'and back again, the far tiles handed as an iterator as the world hands its map\'s values');
  for (const m of [plainMat, variantMat, other]) m.dispose();
  geo.dispose();
}

// --- the session's record of the variant's uniforms ---
{
  const shared = makeAirGroundUniforms();
  const own = airUniforms();
  ok(Object.keys(shared).sort().join() === Object.keys(own).sort().join() && shared.uAirArt.value.w === 0, "the session's record holds every uniform the variant reads, at rest (nothing standing)");
  const tex = new THREE.Texture();
  own.uAirOffsets.value = tex;
  own.uAirArt.value.set(0.5, 1, 0.25, 1);
  own.uAirDentP.value.set(3, 4, 128, 4);
  const art = shared.uAirArt.value;
  copyAirGround(own, shared);
  ok(shared.uAirOffsets.value === tex && shared.uAirArt.value === art && art.x === 0.5 && art.w === 1 && shared.uAirDentP.value.x === 3 && shared.uAirArt.value !== own.uAirArt.value, "a copy moves the values into the session's own objects, never swapping the objects the variant was compiled with");
  tex.dispose();
}

console.log(`\n${checks} checks passed`);
