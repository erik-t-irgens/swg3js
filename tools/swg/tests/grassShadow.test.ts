// The grass's shadows and the far cards beside the trees (wave 8; `src/world/grass.ts`, `grassMath.ts`,
// `grassShadowMath.ts`), read as text where node cannot compile GLSL and driven where it can:
//
//   1. the vertex text, with and without `SWG_GRASS_DEPTH` and with fog and without, and the depth fragment, scanned
//      for a name declared twice in one scope; `cameraPosition` only in the definition of `SWG_GRASS_EYE`; the casting
//      program's sun facing keeps the colour program's fallback; no shadow sampler in the depth texts
//   2. the materials: every shadow sampler a compare depth texture from the start, never null; the colour material
//      casting from both sides; the depth material the same vertex text under the define, unlit, fogless and dry,
//      sharing the uniform objects
//   3. a tuft's mesh: the depth material always hung, a far tile's casting as the tune says as it is built, a near
//      chunk's casting only in reach by `applyCast`, written only on a change
//   4. the cascade hooks: the fourth argument read, a cascade past the count in force drawing no instance for that
//      one draw and the count put back after; and the world's own side, read as text: the cascade named by its
//      shadow camera, the receive on exactly while `cascadesUsable` says, the maps and matrices by identity and the
//      count of cascades worked out every frame (the hooks hung by a real build: grassPlace.test, 5b)
//   5. how many cascades near grass casts into, against the reach and the cascades' own ends at 80, 320 and 800 m
//   6. the receive's mirror against the ambient occlusion's own `cascadeShadowKeep` and against hand values, and
//      `cascadesUsable` the very test `fillCascades` makes
//   7. the window worked out from the reach, metres or scale, and held by the console until `null`; the tint's default
//   8. the far cards and the trees: a card hidden where a chunk's trees are shown, shown and lifted where a chunk
//      stands with them hidden, a sweep's flips reaching the flags, the old rule (`FAR_CARD_RULE.byTrees` off) hiding
//      by the chunk alone, and the default Tree distance leaving every flag as before; the world's one mapping of a
//      chunk's trees to what the cards read, at a build and at a flip (a real build: grassPlace.test, 3)
//
// Run: node tools/swg/tests/grassShadow.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { cascadeShadowKeep } from '../../../src/core/fx/ssaoMath.ts';
import { cascadesUsable, createFxLights, fillCascades } from '../../../src/core/fx/lights.ts';
import { CHUNK_TREES, FAR_CARD_RULE, FarCards, GRASS_CAST, GRASS_DEPTH_FRAGMENT, GRASS_FRAGMENT, GRASS_NO_SHADOW, GRASS_SHADOW_PARS, GRASS_TUNE, GRASS_UNIFORMS, GRASS_VERTEX, GrassField, cardFlags, grassDepthMaterial, grassMaterial, grassWindowNow, setGrassTune, tuftMesh, type GrassHost, type GrassSetup } from '../../../src/world/grass.ts';
import { FAR_CARD_DEFAULTS, GRASS_DEFAULTS, GRASS_SHADOW_DEFAULTS, GRASS_SHADOW_TUNE, TUFT_HIDDEN, TUFT_LIFT, grassCastCascades, grassReach, grassWindowFor, tuftBuffers } from '../../../src/world/grassMath.ts';
import { grassCascadeOf, grassLiftPoint, grassOnMap, grassShade, grassShadeAt, grassShadowKeep } from '../../../src/world/grassShadowMath.ts';
import { PlantSweep, type FloraReachTune, FLORA_DEFAULTS } from '../../../src/world/floraReach.ts';
import { SWAY_UNIFORMS } from '../../../src/world/floraSway.ts';
import { CARD_LIGHT_UNIFORMS } from '../../../src/world/cardLight.ts';
import { glslVariant, redeclared } from './glslScan.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

const resolve = (s: string): string =>
  s.replace(/^[ \t]*#include +<([\w\d./]+)>/gm, (_m, name: string) => {
    const c = (THREE.ShaderChunk as unknown as Record<string, string>)[name];
    if (c === undefined) throw new Error(`no chunk ${name}`);
    return resolve(c);
  });

// ---------------------------------------------------------------- 1. the texts

{
  for (const defs of [new Set<string>(), new Set(['SWG_GRASS_DEPTH']), new Set(['USE_FOG']), new Set(['USE_FOG', 'SWG_GRASS_DEPTH'])]) {
    const v = redeclared(glslVariant(resolve(GRASS_VERTEX), defs));
    ok(v.length === 0, `no name is declared twice in one scope of the vertex stage${defs.size ? ` with ${[...defs].join(' and ')}` : ''}${v.length ? `: ${v.join(', ')}` : ''}`);
  }
  const f = redeclared(resolve(GRASS_DEPTH_FRAGMENT));
  ok(f.length === 0, `nor of the casting program's fragment stage${f.length ? `: ${f.join(', ')}` : ''}`);
  const uses = GRASS_VERTEX.split('cameraPosition').length - 1;
  ok(uses === 1 && /#else\s*#define SWG_GRASS_EYE cameraPosition\s*#endif/.test(GRASS_VERTEX) && /#ifdef SWG_GRASS_DEPTH\s*#define SWG_GRASS_EYE uSwayEye/.test(GRASS_VERTEX), '`cameraPosition` is read once, in the definition of SWG_GRASS_EYE, which is the sway\'s eye in the casting program (a shadow pass\'s camera is the cascade\'s)');
  ok((GRASS_VERTEX.match(/SWG_GRASS_EYE/g) ?? []).length >= 4 && /distance\( swgBase, SWG_GRASS_EYE \)/.test(GRASS_VERTEX) && /SWG_GRASS_EYE - swgBase/.test(GRASS_VERTEX), 'every eye read -- the distance, the facing and the flip -- goes through it');
  const depth = glslVariant(GRASS_VERTEX, new Set(['SWG_GRASS_DEPTH']));
  ok(/if \( uSwgGrassCast\.z > 0\.5 \) swgToward = uSwgLeafSun;\s*#endif\s*swgRight = cross\( swgUp, swgToward \);\s*float swgLen = length\( swgRight \);\s*swgRight = swgLen > 1e-4 \? swgRight \/ swgLen : vec3\( cos\( aSwgTuft\.w \), 0\.0, - sin\( aSwgTuft\.w \) \);/.test(GRASS_VERTEX), 'facing across the sun keeps the colour program\'s own fallback where the cross is too short (the sun overhead: the tuft\'s own yaw)');
  ok(!depth.includes('uSwgGrassShadow') && !GRASS_DEPTH_FRAGMENT.includes('uSwgGrassShadow') && !/sampler2DShadow/.test(depth + GRASS_DEPTH_FRAGMENT), 'the casting program names no shadow sampler, vertex or fragment: it draws into one');
  ok(/if \( swgFar \? uSwgGrassCast\.y < 0\.5 : uSwgGrassCast\.x < 0\.5 \) swgScale = 0\.0;/.test(depth) && !depth.includes('vSwgShadowPos') && !depth.includes('swgSum'), 'and it collapses a near tuft unless near grass casts and a far card unless the far cards do, and leaves the light and the shade out');
  const colour = glslVariant(GRASS_VERTEX, new Set());
  ok(!/sampler2DShadow|textureLod/.test(GRASS_VERTEX) && /textureLod\( uSwgGrassShadow0, swgS\.xyz, 0\.0 \)/.test(GRASS_SHADOW_PARS) && GRASS_FRAGMENT.includes(GRASS_SHADOW_PARS), 'the shadow is looked up in the fragment stage and nowhere in the vertex stage: a shadow compare in a vertex stage lost the WebGL context under ANGLE on the owner\'s machine');
  ok(/vSwgShadowPos = swgP \+ uSwgLeafSun \* \( uSwgGrassShadowOn\.y \* max\( aSwgSize\.x, aSwgSize\.y \) \* swgScale \);/.test(colour) && /vSwgShadowLd = - mvPosition\.z \/ max\( uSwgGrassShadowRange, 1e-3 \);/.test(colour), 'the vertex stage hands on the point lifted toward the sun by a share of the tuft\'s larger side, and its linear depth');
  ok(/vSwgLightSun = swgD >= 0\.0 \? \( uSwgCardFront - uSwgCardTangent \) \* swgD : vec3\( 0\.0 \);/.test(colour) && /vec3 swgMain = swgD >= 0\.0 \? uSwgCardTangent : mix\( uSwgCardTangent, uSwgCardBack, - swgD \);/.test(colour), 'and the light in two parts: everything with the front term at the tangent, and the front term\'s share apart');
  const frag = GRASS_FRAGMENT;
  const cut = frag.indexOf('discard;');
  const shade = frag.indexOf('float swgShade = vSwgReceive > 0.5 ? swgGrassShadow( vSwgShadowPos, vSwgShadowLd ) : 1.0;');
  ok(shade > cut && cut > 0 && /float swgRise = uSwgCardShadowLook > 0\.5 \? 1\.0 : swgShade;/.test(frag) && /clamp\( \( vSwgLight \+ vSwgLightSun \* swgRise \) \* uSwgCardGain, 0\.0, 1\.0 \)/.test(frag), 'the fragment reads the shade after the cut, and a shaded tuft\'s front term falls toward the tangent as a leaf\'s does, or stays whole under the row-7 look');
  for (const defs of [new Set<string>(), new Set(['SWG_GRASS_PROBE']), new Set(['USE_FOG'])]) {
    const f2 = redeclared(glslVariant(resolve(GRASS_FRAGMENT), defs));
    ok(f2.length === 0, `no name is declared twice in one scope of the colour fragment stage${defs.size ? ` with ${[...defs].join(' and ')}` : ''}${f2.length ? `: ${f2.join(', ')}` : ''}`);
  }
  ok(/if \( swgFar && \( swgFlags & 64 \) != 0 \) swgBase\.y \+= uSwgGrassFarLift;/.test(GRASS_VERTEX) && TUFT_LIFT === 64, 'a far card flagged as lifted stands the far ground\'s drop higher, in both programs');
  ok(/if \( swgAlpha < max\( vSwgRef, uSwgGrassCastCut \) \) discard;/.test(GRASS_DEPTH_FRAGMENT) && /gl_FragColor = vec4\( 1\.0 \);/.test(GRASS_DEPTH_FRAGMENT), 'the casting fragment keeps the picture, its mip raise and a cut of its own, and writes nothing read');
}

// ---------------------------------------------------------------- 2. the materials

{
  const u = GRASS_UNIFORMS;
  const samplers = [u.uSwgGrassShadow0.value, u.uSwgGrassShadow1.value, u.uSwgGrassShadow2.value];
  ok(samplers.every((t) => t === GRASS_NO_SHADOW) && GRASS_NO_SHADOW.isDepthTexture && GRASS_NO_SHADOW.compareFunction === THREE.LessEqualCompare, 'every shadow sampler starts on a compare depth texture of its own, never null (a null shadow sampler drops the draw)');
  const colour = grassMaterial();
  ok(colour.shadowSide === THREE.DoubleSide, 'the colour material casts from both sides: three hands a depth material its source\'s shadow side');
  ok(colour.uniforms.uSwgGrassShadow0 === u.uSwgGrassShadow0 && colour.uniforms.uSwgGrassShadowMatrix === u.uSwgGrassShadowMatrix && colour.uniforms.uSwgCardRow7 === CARD_LIGHT_UNIFORMS.uSwgCardRow7, 'it reads the shared shadow uniforms, and the card light\'s shadow row');
  const d = grassDepthMaterial();
  ok(d.vertexShader === GRASS_VERTEX && d.fragmentShader === GRASS_DEPTH_FRAGMENT && d.defines.SWG_GRASS_DEPTH === '' && !d.lights && !d.fog && !d.toneMapped && d.userData.unlit === true && d.userData.dry === true, 'the depth material is the same vertex text under SWG_GRASS_DEPTH, unlit, fogless and dry');
  ok(d.uniforms.uSwayEye === SWAY_UNIFORMS.uSwayEye && d.uniforms.uSwgGrassMap === u.uSwgGrassMap && d.uniforms.uSwgGrassCast === u.uSwgGrassCast && d.uniforms.uSwgLeafSun === CARD_LIGHT_UNIFORMS.uSwgLeafSun && d.uniforms.uSwgGrassShadow0 === undefined, 'sharing the uniform objects by reference, the shadow\'s own left out');
}

// ---------------------------------------------------------------- 3. a tuft's mesh and what casts

{
  const colour = grassMaterial();
  const depth = grassDepthMaterial();
  const b = tuftBuffers(1);
  b.count = 1;
  b.size.set([1, 1, 0, 4]);
  GRASS_SHADOW_TUNE.farCast = false;
  const farOff = tuftMesh(b, colour, depth, true);
  GRASS_SHADOW_TUNE.farCast = true;
  const farOn = tuftMesh(b, colour, depth, true);
  GRASS_SHADOW_TUNE.cast = true;
  const near = tuftMesh(b, colour, depth, false);
  Object.assign(GRASS_SHADOW_TUNE, GRASS_SHADOW_DEFAULTS);
  ok(farOff.customDepthMaterial === depth && near.customDepthMaterial === depth && !farOff.castShadow && farOn.castShadow && !near.castShadow && !near.receiveShadow, 'every mesh hangs the depth material; a far tile\'s casts as the tune says the moment it is made, a near chunk\'s not until its field finds it in reach, and none asks three to receive');
  const src = readFileSync(new URL('../../../src/world/grass.ts', import.meta.url), 'utf8');
  ok(src.includes('const mesh = tuftMesh(trimmed, this.material, this.depth, false);') && src.includes('const mesh = tuftMesh(trimmed, this.material, this.depth, true);'), 'and every mesh a chunk or a tile builds is made through it, with the field\'s depth material');
}

// ---------------------------------------------------------------- 4 and 3b. the hooks and the reach

const cams = [new THREE.OrthographicCamera(), new THREE.OrthographicCamera(), new THREE.OrthographicCamera()];
const probe = new THREE.PerspectiveCamera();
const trees = new Map<string, number>();
const host: GrassHost = {
  circlesFor: () => {},
  adopt: () => {},
  chunkTrees: (cx, cz) => trees.get(`${cx},${cz}`) ?? CHUNK_TREES.none,
  cascadeOf: (c) => Math.max(0, cams.indexOf(c as THREE.OrthographicCamera)),
};
const nearTiling = { tileSize: 1, tileBorder: 0, maximumDistance: 30, minimumDistance: 0 } as unknown as GrassSetup['near'];
const farTiling = { tileSize: 16, tileBorder: 0, maximumDistance: 600, minimumDistance: 0 } as unknown as GrassSetup['far'];
const setup = { src: null, world: null, file: { size: 256 }, near: nearTiling, far: farTiling, shift: { x: 0, z: 0 }, reference: null } as unknown as GrassSetup;
{
  const colour = grassMaterial();
  const depth = grassDepthMaterial();
  const field = new GrassField(colour, host, depth);
  const f = field as unknown as { setup: GrassSetup | null; chunks: { cx: number; cz: number; x0: number; z0: number; mesh: THREE.Mesh | null; built: boolean }[]; beforeShadow: THREE.Object3D['onBeforeShadow']; afterShadow: THREE.Object3D['onAfterShadow'] };
  f.setup = setup;
  for (const [cx, cz] of [[0, 0], [1, 0], [3, 0]]) {
    field.chunkMade(cx, cz, new THREE.Group());
    const c = f.chunks[f.chunks.length - 1];
    const b = tuftBuffers(5);
    b.count = 5;
    const m = tuftMesh(b, colour, depth, false);
    m.onBeforeShadow = f.beforeShadow;
    m.onAfterShadow = f.afterShadow;
    c.mesh = m;
    c.built = true;
  }
  const eye = new THREE.Vector3(60, 1.7, 10);
  field.applyCast(eye);
  ok(f.chunks.every((c) => !c.mesh!.castShadow), 'with near grass not casting, no chunk casts');
  GRASS_SHADOW_TUNE.cast = true;
  field.applyCast(eye);
  ok(f.chunks[0].mesh!.castShadow && f.chunks[1].mesh!.castShadow && !f.chunks[2].mesh!.castShadow, 'casting on, the chunks whose square lies within the reach of the eye cast (the eye\'s own and the one 4 m off), and one 132 m off does not');
  // Every write of `castShadow` counted, whatever it writes.
  let writes = 0;
  for (const c of f.chunks) {
    let v = c.mesh!.castShadow;
    Object.defineProperty(c.mesh!, 'castShadow', {
      get: () => v,
      set: (x: boolean) => {
        writes++;
        v = x;
      },
      configurable: true,
    });
  }
  field.applyCast(eye);
  ok(writes === 0 && field.casting === 2, `a frame that moves nothing writes nothing (${writes} writes)`);
  field.applyCast(new THREE.Vector3(200, 1.7, 10));
  ok(writes === 3 && !f.chunks[0].mesh!.castShadow && !f.chunks[1].mesh!.castShadow && f.chunks[2].mesh!.castShadow, `and one that carries the eye to the far chunk writes the three that change, once each (${writes} writes)`);
  field.applyCast(eye);
  // The hooks, as three's shadow pass calls them: (renderer, object, camera asked for -- the probe -- , the cascade's camera, geometry).
  const g = f.chunks[0].mesh!.geometry as THREE.InstancedBufferGeometry;
  const r = null as unknown as THREE.WebGLRenderer;
  const scene = null as unknown as THREE.Scene;
  const mesh = f.chunks[0].mesh!;
  GRASS_CAST.cascades = 1;
  const drawn: number[] = [];
  for (const cam of cams) {
    mesh.onBeforeShadow(r, scene, probe, cam, g, depth, null as never);
    drawn.push(g.instanceCount);
    mesh.onAfterShadow(r, scene, probe, cam, g, depth, null as never);
  }
  ok(JSON.stringify(drawn) === '[5,0,0]' && g.instanceCount === 5, `with one cascade in force the first is drawn every tuft and the other two none, read off the fourth argument (the third is the probe), and the count is put back after each draw (${drawn.join(', ')})`);
  GRASS_CAST.cascades = 2;
  drawn.length = 0;
  for (const cam of cams) {
    mesh.onBeforeShadow(r, scene, probe, cam, g, depth, null as never);
    drawn.push(g.instanceCount);
    mesh.onAfterShadow(r, scene, probe, cam, g, depth, null as never);
  }
  ok(JSON.stringify(drawn) === '[5,5,0]' && g.instanceCount === 5, 'two in force, the first two');
  GRASS_CAST.cascades = 1;
  Object.assign(GRASS_SHADOW_TUNE, GRASS_SHADOW_DEFAULTS);
  const worldTs = readFileSync(new URL('../../../src/world/world.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  ok(/this\.grass\?\.update\(camPos, 1\);\s*this\.farCards\?\.update\(camPos\);[\s\S]{0,200}this\.grass\?\.applyCast\(camPos\);/.test(worldTs), 'the world asks which chunks cast every frame, after the grass has moved its window');
  ok(/csm\.update\(\);[\s\S]{0,120}\}\s*this\.syncGrassShadows\(\);/.test(worldTs), 'and hands the grass the cascades every frame after they moved');
  // The world's side of the hooks and the receive, which only a browser runs: pinned as text.
  ok(/cascadeOf: \(cam\) => \{\s*const lights = this\.csm\?\.lights;\s*if \(lights\) for \(let i = 0; i < lights\.length; i\+\+\) if \(lights\[i\]\.shadow\.camera === cam\) return i;\s*return 0;/.test(worldTs), 'the world names a cascade by its own shadow camera, which is what the hooks\' fourth argument is');
  const sync = worldTs.slice(worldTs.indexOf('  private syncGrassShadows(): void {'), worldTs.indexOf('  warmUp(center: THREE.Vector3): void {'));
  ok(/const on = !!csm && !!r && !!cam && cascadesUsable\(r, csm\.lights, csm\.breaks\);\s*u\.uSwgGrassShadowOn\.value\.x = on \? 1 : 0;/.test(sync), 'the grass reads the cascades exactly while the effects\' own test says they can be read, written every frame');
  ok(/if \(slot\.value !== map\) slot\.value = map;/.test(sync) && /if \(m\[i\] !== s\.matrix\) m\[i\] = s\.matrix;/.test(sync) && /GRASS_NO_SHADOW/.test(sync), 'each cascade\'s map and its own matrix handed over by identity, the stand-in where they cannot be read');
  ok(/this\.cascadeEnds\[i\] = this\.cascadeFar\(i\);/.test(sync) && /GRASS_CAST\.cascades = setup \? grassCastCascades\(grassReach\(setup\.near, GRASS_TUNE\), this\.cascadeEnds, GRASS_SHADOW_TUNE\.castCascades\) : 0;/.test(sync) && /GRASS_CAST\.cascades = 0;\s*return;/.test(sync), 'and how many cascades near grass casts into worked out every frame from the reach in force and the cascades\' own ends, none while they cannot be read');
}

// ---------------------------------------------------------------- 5. how many cascades

{
  // Three's CSM `practical` split (half uniform, half logarithmic) with the game's near of 0.1 m, as `World.cascadeFar` reads it.
  const ends = (far: number): number[] => {
    const near = 0.1;
    const out: number[] = [];
    for (let i = 1; i < 3; i++) {
      const uni = (near + ((far - near) * i) / 3) / far;
      const log = (near * (far / near) ** (i / 3)) / far;
      out.push(near + (far - near) * (uni + (log - uni) * 0.5));
    }
    out.push(far);
    return out;
  };
  const at320 = ends(320);
  const at80 = ends(80);
  ok(Math.abs(at320[0] - 54) < 1 && Math.abs(at80[0] - 14) < 1, `the first cascade ends about 54 m out at the default 320 m and about 14 m out at 80 m (${at320[0].toFixed(1)}, ${at80[0].toFixed(1)})`);
  const want: Record<string, number> = { '80,20': 2, '80,32': 3, '80,96': 3, '320,20': 1, '320,32': 1, '320,96': 2, '800,20': 1, '800,32': 1, '800,96': 1 };
  for (const [k, n] of Object.entries(want)) {
    const [far, reach] = k.split(',').map(Number);
    ok(grassCastCascades(reach, ends(far), 3) === n, `at a ${far} m Shadow distance a reach of ${reach} m casts into ${n} cascade${n > 1 ? 's' : ''}`);
  }
  ok(grassCastCascades(96, at80, 1) === 1 && grassCastCascades(32, at320, 0) === 0 && grassCastCascades(0, at320, 3) === 0, 'never past `castCascades`, and none with no reach');
}

// ---------------------------------------------------------------- 6. the receive's mirror

{
  const c = { ranges: [0, 0.1, 0.1, 0.3, 0.3, 1], range: 100, fade: true };
  ok(grassCascadeOf(0.099, c.ranges) === 0 && grassCascadeOf(0.1, c.ranges) === 1 && grassCascadeOf(0.299, c.ranges) === 1 && grassCascadeOf(0.3, c.ranges) === 2, 'the pick is the ambient occlusion\'s: each cascade up to its own end, the next from it');
  let same = true;
  for (let ld = 0; ld <= 1.3; ld += 0.01) for (const fade of [true, false]) if (grassShadowKeep(ld, { ...c, fade }) !== cascadeShadowKeep(ld, 0.3, 1, fade)) same = false;
  ok(same, 'the keep is the ambient occlusion\'s own `cascadeShadowKeep`, called and not said again, faded and not');
  ok(grassShadowKeep(0.6, c) === 1 && Math.abs(grassShadowKeep(0.95, c) - 0.7) < 1e-9 && Math.abs(grassShadowKeep(1, c) - 0.5) < 1e-9 && grassShadowKeep(1.13, c) === 0, 'by hand: whole to the last cascade\'s middle, 0.7 at 95 m, half at its end, none past the margin');
  const out = { x: 0, y: 0, z: 0 };
  grassLiftPoint(1, 2, 3, { x: 0, y: 1, z: 0 }, 1, 0.6, 0.9, 0.5, out);
  ok(Math.abs(out.y - 2.45) < 1e-9 && out.x === 1 && out.z === 3, 'the lift is the share of the tuft\'s larger side at its scale, toward the sun');
  ok(grassOnMap(0.5, 0.5, 1) && !grassOnMap(-0.01, 0.5, 0.5) && !grassOnMap(0.5, 1.01, 0.5) && !grassOnMap(0.5, 0.5, 1.001), 'off the map, or past its far plane, a corner is lit');
  ok(grassShade(0, 0.8, 1) === 1 - 0.8 && grassShade(1, 0.8, 1) === 1 && Math.abs(grassShade(0, 1, 0.5) - 0.5) < 1e-12, 'the shade is the lookup taken at the intensity times the keep');
  const depthAt = () => 0.5;
  const coord = () => ({ x: 0.5, y: 0.5, z: 0.52 });
  ok(Math.abs(grassShadeAt(0.05, c, 1, coord, [0, 0, 0], depthAt)) < 1e-12 && grassShadeAt(0.05, c, 1, coord, [-0.03, 0, 0], depthAt) === 1, 'the whole line: past the stored depth shaded, a bias lowering the compared depth under it lit');
  const lights = [0, 1, 2].map(() => ({ castShadow: true, shadow: { map: { depthTexture: { compareFunction: THREE.LessEqualCompare } }, matrix: new THREE.Matrix4(), bias: 0, normalBias: 0, intensity: 1 } })) as unknown as THREE.DirectionalLight[];
  const r = { shadowMap: { enabled: true } };
  ok(cascadesUsable(r, lights, [0.1, 0.3, 1]) && !cascadesUsable({ shadowMap: { enabled: false } }, lights, [0.1, 0.3, 1]) && !cascadesUsable(r, lights.slice(0, 2), [0.1, 0.3, 1]), 'the cascades are readable with the shadow map on and three of them');
  (lights[1].shadow as unknown as { map: null }).map = null;
  ok(!cascadesUsable(r, lights, [0.1, 0.3, 1]), 'and not while one has no map yet');
  const fx = createFxLights();
  fillCascades(fx.sky.cascades, r, lights, [0.1, 0.3, 1], 100);
  ok(fx.sky.cascades.count === 0, 'which is the very test the effects\' `fillCascades` makes');
  const lightsTs = readFileSync(new URL('../../../src/core/fx/lights.ts', import.meta.url), 'utf8');
  ok(/if \(!cascadesUsable\(renderer, lights, breaks\)\) return;/.test(lightsTs), 'one function, which `fillCascades` calls');
}

// ---------------------------------------------------------------- 7. the window and the tint

{
  ok(grassWindowFor(20) === 3 && grassWindowFor(32) === 3 && grassWindowFor(64) === 3 && grassWindowFor(65) === 5 && grassWindowFor(96) === 5 && grassWindowFor(500) === 9, 'the window is three chunks at the worlds\' own reaches, five past 64 m, and never past nine');
  const keep = { ...GRASS_TUNE };
  setGrassTune({ reachScale: 3 });
  ok(grassWindowNow(setup) === 5 && grassReach(setup.near, GRASS_TUNE) === 90, 'it follows the page\'s scale: three times a 30 m reach is 90 m, a window of five');
  setGrassTune({ reach: 40, reachScale: 1 });
  ok(grassWindowNow(setup) === 3, 'and a reach typed in metres, which stands over the scale');
  setGrassTune({ window: 7 });
  ok(grassWindowNow(setup) === 7 && GRASS_TUNE.windowHold === 7, 'a window typed outright holds');
  setGrassTune({ window: null, reach: null });
  ok(grassWindowNow(setup) === 3 && GRASS_TUNE.windowHold === null, 'until `window: null` hands it back to the reach');
  Object.assign(GRASS_TUNE, keep);
  ok(GRASS_DEFAULTS.tint === 'ground' && GRASS_DEFAULTS.reachScale === 1 && FAR_CARD_DEFAULTS.reachScale === 1 && GRASS_DEFAULTS.windowHold === null, 'the grass takes the ground\'s own tint by default (the owner\'s), and both reach scales start at one');
}

// ---------------------------------------------------------------- 8. the far cards and the trees

{
  ok(cardFlags(4, CHUNK_TREES.shown) === 4 + TUFT_HIDDEN && cardFlags(4 + TUFT_HIDDEN, CHUNK_TREES.none) === 4 && cardFlags(4 + TUFT_HIDDEN, CHUNK_TREES.hidden) === 4 + TUFT_LIFT && cardFlags(4 + TUFT_LIFT, CHUNK_TREES.shown) === 4 + TUFT_HIDDEN, 'a card is hidden where a chunk\'s trees are shown, shown where none stands, and shown lifted where one stands with its trees hidden');
  FAR_CARD_RULE.byTrees = false;
  ok(cardFlags(4, CHUNK_TREES.hidden) === 4 + TUFT_HIDDEN, 'by the old rule a card is hidden wherever a chunk stands');
  FAR_CARD_RULE.byTrees = true;
  // A real far cards' set with one tile of cards standing over four buckets, made by hand where a terrain would place them.
  const colour = grassMaterial();
  const cards = new FarCards(colour, host, new THREE.Group(), 512, 2.5, grassDepthMaterial());
  (cards as unknown as { setup: GrassSetup }).setup = setup;
  ok(GRASS_UNIFORMS.uSwgGrassFarLift.value === 2.5, 'the lift is the far ground\'s own drop, handed over as the set is made');
  const b = tuftBuffers(4);
  b.count = 4;
  const buckets = [[0, 0], [1, 0], [2, 0], [3, 0]];
  buckets.forEach(([bx, bz], i) => {
    b.tuft.set([bx * 64 + 10, 0, bz * 64 + 10, 0], i * 4);
    b.size.set([1, 1, 0, 4], i * 4);
  });
  trees.set('0,0', CHUNK_TREES.shown);
  trees.set('1,0', CHUNK_TREES.hidden);
  const mesh = tuftMesh(b, colour, null, true);
  const tile = { tx: 0, tz: 0, ox: 0, oz: 0, samples: null, mesh, built: true, buffers: b, bucketX: new Int32Array([0, 1, 2, 3]), bucketZ: new Int32Array(4) };
  for (let i = 0; i < 4; i++) b.size[i * 4 + 3] = cardFlags(b.size[i * 4 + 3], host.chunkTrees(buckets[i][0], buckets[i][1]));
  (cards as unknown as { tiles: unknown[] }).tiles.push(tile);
  const flags = () => [0, 1, 2, 3].map((i) => b.size[i * 4 + 3]);
  // The tile above is made by hand with its flags set by the rule a build applies (the real build, over a terrain, is
  // grassPlace.test's section 3); here it is the fixture the sweep's flips are handed to.
  ok(JSON.stringify(flags()) === JSON.stringify([4 + TUFT_HIDDEN, 4 + TUFT_LIFT, 4, 4]), 'by the build\'s rule: hidden over the chunk whose trees show, lifted over the one whose trees are hidden, shown where none stands');
  const grassTs = readFileSync(new URL('../../../src/world/grass.ts', import.meta.url), 'utf8');
  ok(/trimmed\.size\[i \* 4 \+ 3\] = cardFlags\(trimmed\.size\[i \* 4 \+ 3\], this\.host\.chunkTrees\(bx, bz\)\);/.test(grassTs), 'which is the rule the far cards\' own build writes into every card it makes, from what the world says stands in its bucket');
  const rep = cards.report(new THREE.Vector3(0, 0, 0));
  ok(rep.hidden === 1 && rep.overChunks === 1, `and the console counts the card shown inside the detailed ground (${rep.overChunks})`);
  // A plant sweep over stand-in chunks with a 128 m Tree distance: the flips it reports, handed over as the world hands them.
  const tune: FloraReachTune = { ...FLORA_DEFAULTS, treeReach: 128 };
  const sweep = new PlantSweep();
  const chunk = (cx: number, mx: number) => ({ cx, cz: 0, mx, my: 0, mz: 32, trees: { visible: true, children: [] }, plants: null });
  const chunks = [chunk(0, 32), chunk(1, 96), chunk(2, 160), chunk(3, 224)];
  sweep.begin(20, 0, 32, 100, true);
  const cxs: number[] = [];
  const states: number[] = [];
  for (const c of chunks) if (sweep.visit(c, tune)) {
    cxs.push(c.cx);
    states.push(c.trees.visible ? CHUNK_TREES.shown : CHUNK_TREES.hidden);
  }
  ok(JSON.stringify(cxs) === '[2,3]', `a sweep with a 128 m Tree distance flips the trees of the chunks past it, and says which (${cxs.join(', ')})`);
  const was = mesh.geometry.getAttribute('aSwgSize').version;
  cards.chunksChanged(cxs, cxs.map(() => 0), states, cxs.length);
  ok(JSON.stringify(flags()) === JSON.stringify([4 + TUFT_HIDDEN, 4 + TUFT_LIFT, 4 + TUFT_LIFT, 4 + TUFT_LIFT]) && mesh.geometry.getAttribute('aSwgSize').version > was, 'handed to the far cards, the cards over those chunks stand lifted in for the trees, within the one sweep, and the attribute goes up');
  // The default Tree distance: every chunk's trees shown, every card over a chunk hidden, as before the wave.
  const back = new PlantSweep();
  back.begin(20, 0, 32, 100, true);
  const flips: number[] = [];
  for (const c of chunks) if (back.visit(c, { ...FLORA_DEFAULTS })) flips.push(c.cx);
  cards.chunksChanged(flips, flips.map(() => 0), flips.map(() => CHUNK_TREES.shown), flips.length);
  ok(JSON.stringify(flips) === '[2,3]' && JSON.stringify(flags()) === JSON.stringify([4 + TUFT_HIDDEN, 4 + TUFT_LIFT, 4 + TUFT_HIDDEN, 4 + TUFT_HIDDEN]), 'and back at the default Tree distance the trees come back and the cards over them are hidden, as they always were (the chunk the stand-in left hidden keeps its lift until its own sweep shows its trees)');
  cards.chunksChanged([0, 1, 2, 3], [0, 0, 0, 0], [CHUNK_TREES.none, CHUNK_TREES.none, CHUNK_TREES.none, CHUNK_TREES.none], 4);
  ok(flags().every((f) => f === 4), 'and every chunk gone, every card shown and none lifted');
  FAR_CARD_RULE.byTrees = false;
  cards.chunksChanged([1], [0], [CHUNK_TREES.hidden], 1);
  ok(flags()[1] === 4 + TUFT_HIDDEN, '`farCardsByTrees` off hides a card over a chunk whatever its trees, the old rule');
  FAR_CARD_RULE.byTrees = true;
  const worldTs = readFileSync(new URL('../../../src/world/world.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  ok(/this\.farCards\?\.chunksChanged\(this\.changedCx, this\.changedCz, this\.changedTrees, this\.changedN\);/.test(worldTs) && /this\.changedTrees\[i\] = loaded \? this\.grassHost\.chunkTrees\(cx, cz\) : CHUNK_TREES\.none;/.test(worldTs), 'the stream hands each chunk made its trees\' state, after the sweep has set it, beside the `loaded` the far tiles\' cut still reads');
  // What the world says stands in a bucket, at a build and at a sweep's flip: the one mapping, twice.
  ok(/chunkTrees: \(cx, cz\) => \{\s*const c = this\.chunks\.get\(`\$\{cx\},\$\{cz\}`\);\s*if \(!c\) return CHUNK_TREES\.none;\s*return c\.trees && !c\.trees\.visible \? CHUNK_TREES\.hidden : CHUNK_TREES\.shown;/.test(worldTs), 'the world answers a bucket with no chunk as none, a chunk whose trees are hidden as hidden, and any other chunk as shown');
  ok(/this\.flipTrees\[i\] = c\.trees && !c\.trees\.visible \? CHUNK_TREES\.hidden : CHUNK_TREES\.shown;/.test(worldTs), 'and a chunk whose trees a sweep flipped by the same mapping');
}

console.log(`\ngrassShadow: ${passed} checks passed`);
