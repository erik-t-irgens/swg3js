// The tile ground's air variant as text (src/world/volumetrics/airGround.ts; the volumetrics design's §10 Tests,
// research-amend-ground §2.11): the variant over `THREE.ShaderLib.standard` after `injectGroundTiles` -- every anchor
// found exactly once (`#include <color_fragment>` among them), the tile program's `TILE_MAP` in the variant byte for byte
// (the ground's own picture never moves), the blowing sand laid after the albedo line and before the wet block, or
// nothing written; a copy with the albedo line gone, an anchor gone or doubled, or a global it reads undeclared makes
// the rewrite write nothing; the samplers it adds are five; nothing the scanners refuse (a call to a function it does not
// define among them) that the plain program has not already; the plain material's text and key unchanged (the commit
// before the pass holds them, `airOff.test.ts`); the chooser's table (the master × the tile program × each switch × the
// field × the soft off); the swap; and the session's record of the variant's uniforms.
//
// Node compiles no GLSL: `__debug.air({ groundSelfTest: true })` draws the variant in the browser. Plain type stripping.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GROUND_DECLS_END, GROUND_TILES_KEY, TILE_MAP, groundTilesMaterial, injectGroundTiles, makeGroundTileUniforms } from '../../../src/world/terrainTextures.ts';
import { AIR_GROUND_ANCHORS, copyAirGround, GROUND_AIR_KEY, groundAirMaterial, groundMaterialFor, groundWearsAir, injectGroundAir, makeAirGroundUniforms, swapGroundMaterial, TILE_ALBEDO_LINE, TILE_GLOBALS_READ, type AirGroundUniforms, type GroundChoice } from '../../../src/world/volumetrics/airGround.ts';
import { glslVariant, redeclared, reservedWords, unbalanced, undefinedCalls, uniformNames } from './glslScan.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const count = (s: string, needle: string): number => s.split(needle).length - 1;

const airUniforms = (): AirGroundUniforms => makeAirGroundUniforms();
const standard = () => ({ vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} as Record<string, unknown> });

// --- the plain tile program, as `injectGroundTiles` writes it ---
const plain = standard();
ok(injectGroundTiles(plain, makeGroundTileUniforms()), 'the plain tile program goes into three\'s standard shader');
const plainFs = plain.fragmentShader;
ok(count(plainFs, TILE_MAP) === 1 && count(plainFs, TILE_ALBEDO_LINE) === 1, 'the tile program\'s colour stage is in the plain text exactly once, its albedo line with it');
ok(AIR_GROUND_ANCHORS.every((a) => count(plainFs, a) === 1) && AIR_GROUND_ANCHORS.includes('#include <color_fragment>'), `and every anchor the variant writes at is there exactly once (${AIR_GROUND_ANCHORS.join(', ')})`);

// --- the variant ---
const air = airUniforms();
const v = { ...plain, uniforms: { ...plain.uniforms } };
ok(injectGroundAir(v, air), 'the variant goes in over it');
const fs = v.fragmentShader;
ok(v.vertexShader === plain.vertexShader, 'and touches no vertex text: no vertex moves and no varying is added');
ok(count(fs, TILE_MAP) === 1, "TILE_MAP is in the variant byte for byte: the ground's own picture never moves (the second wave's eight rewritten calls are gone)");
ok(!fs.includes('gAirShift') && !fs.includes('vGroundUV + '), 'and no layer is sampled anywhere but where it rests');
{
  const common = fs.indexOf('#include <common>');
  const pars = fs.indexOf('uniform sampler2D uAirOffsets;');
  const declsEnd = fs.indexOf(GROUND_DECLS_END);
  ok(common >= 0 && pars > common && declsEnd > pars, 'its declarations sit after three\'s common chunk and the tile program\'s own, before the declarations\' end');
  const map = fs.indexOf('#include <map_fragment>');
  const block = fs.indexOf('if ( uAirArt.w > 0.5 ) {');
  const tileMap = fs.indexOf(TILE_MAP);
  ok(map >= 0 && block > map && tileMap > block, "the sand's strength and grains, the dents and the shade are worked out after the map chunk, before the tile program's colour stage");
  const derivs = fs.indexOf('vec2 gAirPDx = dFdx( gAirW ) / uAirSandP.z;');
  const firstBranch = fs.indexOf('if ( gAirIn > 0.0 ) {');
  ok(derivs > block && derivs < firstBranch, "the picture's derivatives are taken in uniform control flow, before any branch on a pixel's own values");
  const albedo = fs.indexOf(TILE_ALBEDO_LINE);
  const colourStage = fs.indexOf('#include <color_fragment>');
  const overlay = fs.indexOf('if ( uAirArt.x != 0.0 && gAirSandStr > 0.0 ) {');
  const wet = fs.indexOf('if (uWetness + uSnowCover > 0.0005) {');
  ok(albedo >= 0 && colourStage > albedo && overlay > colourStage && wet > overlay, 'the blowing sand is laid after the albedo line and the colour stage and before the wet block, so the rain darkens the sand too');
  const normalMaps = fs.indexOf('#include <normal_fragment_maps>');
  const bend = fs.indexOf('if ( gAirDentSlope.x != 0.0 || gAirDentSlope.y != 0.0 ) {');
  const tileNormal = fs.indexOf('vec3 gn = gGroundBump.xyz * 2.0 - 1.0;');
  ok(normalMaps >= 0 && bend > normalMaps && tileNormal > bend, 'the dent\'s bend goes into the normal before the tile program adds the ground\'s own lean and bump to it');
  ok(overlay < tileNormal && fs.indexOf('gGroundBump = mix( gGroundBump, vec4( 0.5, 0.5, 1.0, 0.0 ), gAirA * uAirSandR.x );') > overlay, "and the grains' flattening of the relief is laid before the tile program reads the bump");
  const lightsEnd = fs.indexOf('#include <lights_fragment_end>');
  const shade = fs.indexOf('if ( gAirShade < 1.0 ) {');
  const opaque = fs.indexOf('#include <opaque_fragment>');
  ok(lightsEnd >= 0 && shade > lightsEnd && opaque > shade, 'the dust\'s shadow comes off the direct light once the lights are summed, before the light leaves');
}
ok(/if \( uAirArt\.x != 0\.0 \) \{/.test(fs) && /if \( uAirArt\.y != 0\.0 \) \{/.test(fs) && /if \( uAirArt\.z != 0\.0 \) \{/.test(fs) && /if \( gAirShade < 1\.0 \) \{/.test(fs), 'every term is behind a uniform branch on its own dial');
ok(/if \( uAirArt\.x != 0\.0 && gAirSandStr > 0\.0 \) \{[\s\S]*?\} else if \( gAirA > 0\.0 \) \{/.test(fs), "the sand's every write is behind its dial and then a test that it lays anything: at nought, where nothing blows or over ground that does not blow, diffuseColor and gGroundBump are not written");
ok(count(fs, 'airFinite') >= 6 && fs.includes('vec4 gAirO = airFinite4( texture( uAirOffsets, gAirUv + uAirShift.xy ) );'), 'every field read is made finite before it is used');
{
  const before = new Set(uniformNames(plainFs));
  const added = uniformNames(fs).filter((n) => !before.has(n));
  const samplers = added.filter((n) => new RegExp(`uniform\\s+sampler2D\\s+${n}\\s*;`).test(fs));
  // Six from the third wave (the sand carried in the air, `uAirCarry`): fifteen of the sixteen Direct3D 11 allows with
  // the tile program's own, one under the ceiling (W3-notes.md records the design's fourteen as a deviation).
  ok(samplers.length === 6 && ['uAirOffsets', 'uAirCarry', 'uAirDents', 'uAirLayers', 'uAirLight', 'uAirSand'].every((n) => samplers.includes(n)), `the samplers it adds are six (${samplers.join(', ')}): fifteen of sixteen with the tile program's own`);
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
  const added = (ch: string): number => count(fs, ch) - count(plainFs, ch);
  ok(added('{') > 0 && added('{') === added('}') && added('(') === added(')') && unbalanced(plainFs) !== '', `what it adds balances its brackets (${added('{')} braces and ${added('(')} parentheses each way)`);
  const twice = fresh(redeclared(plainV), redeclared(varV));
  ok(twice.length === 0, `no name declared twice in one scope${twice.length ? `: ${twice.join(', ')}` : ''}`);
  const calls = fresh(undefinedCalls(plainFs), undefinedCalls(fs));
  ok(calls.length === 0, `no call to a function it does not define that the plain program has not already${calls.length ? `: ${calls.join(', ')}` : ''}`);
  const broken = fs.replace('float airBlows( const in float layer )', 'float airBlowsOf( const in float layer )').replace('texelFetch( uAirLayers', 'texelFetchh( uAirLayers');
  const caught = fresh(undefinedCalls(plainFs), undefinedCalls(broken));
  ok(broken !== fs && caught.includes('airBlows') && caught.includes('texelFetchh'), `the scan names a helper renamed at its definition and a misspelt built-in (${caught.join(', ')})`);
  ok(!/sampler2DShadow/.test(fs.slice(fs.indexOf('uniform sampler2D uAirOffsets;'), fs.indexOf(GROUND_DECLS_END))), 'no shadow compare of its own');
}

// --- all or nothing ---
{
  const tries: [string, string][] = [];
  tries.push(['the albedo line gone', plainFs.replace(TILE_ALBEDO_LINE, '')]);
  tries.push(['the albedo line after the colour stage', plainFs.replace(TILE_ALBEDO_LINE, '').replace('#include <color_fragment>', `#include <color_fragment>\n${TILE_ALBEDO_LINE}`)]);
  tries.push(['TILE_MAP changed', plainFs.replace('vec2 gDx = dFdx( vGroundUV );', 'vec2 gDx = dFdx( vGroundUV ) * 1.0;')]);
  tries.push(['TILE_MAP doubled', plainFs.replace(GROUND_DECLS_END, `/*${TILE_MAP}*/\n${GROUND_DECLS_END}`)]);
  for (const g of TILE_GLOBALS_READ) tries.push([`the global "${g}" undeclared`, plainFs.split(g).join(g.replace(' =', 'X ='))]);
  for (const a of AIR_GROUND_ANCHORS) {
    tries.push([`the anchor ${a} gone`, plainFs.split(a).join('')]);
    tries.push([`the anchor ${a} doubled`, plainFs.replace(a, `${a}\n// ${a}`)]);
  }
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
  ok(all && tries.length === 4 + TILE_GLOBALS_READ.length + 2 * AIR_GROUND_ANCHORS.length, `over ${tries.length} copies of the tile program with its albedo line gone or moved, TILE_MAP changed or doubled, a global undeclared or an anchor gone or doubled, the rewrite writes nothing and adds no uniform${failed.length ? ` (it wrote over: ${failed.join('; ')})` : ''}`);
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
  ok(['uAirSand', 'uAirPhase', 'uAirJitter', 'uAirSandP', 'uAirSandQ', 'uAirSandR'].every((k) => k in shared), "and from wave 2b the blowing sand's: its picture, its phases, its jitter and its three looks");
  const tex = new THREE.Texture();
  const pic = new THREE.Texture();
  own.uAirOffsets.value = tex;
  own.uAirSand.value = pic;
  own.uAirArt.value.set(0.5, 1, 0.25, 1);
  own.uAirDentP.value.set(3, 4, 128, 4);
  own.uAirPhase.value.set(0.4, 1.2, 1, 0.625);
  own.uAirSandP.value.set(0.3, 1.5, 8, 0.08);
  const art = shared.uAirArt.value;
  const phase = shared.uAirPhase.value;
  copyAirGround(own, shared);
  ok(shared.uAirOffsets.value === tex && shared.uAirSand.value === pic && shared.uAirArt.value === art && art.x === 0.5 && art.w === 1 && shared.uAirDentP.value.x === 3 && shared.uAirArt.value !== own.uAirArt.value, "a copy moves the values into the session's own objects, never swapping the objects the variant was compiled with");
  ok(shared.uAirPhase.value === phase && phase.x === 0.4 && phase.z === 1 && shared.uAirSandP.value.x === 0.3 && shared.uAirSandP.value !== own.uAirSandP.value, "the sand's numbers likewise");
  tex.dispose();
  pic.dispose();
}

console.log(`\n${checks} checks passed`);
