// The grass's program (materials and ground pass, waves 5b and 5c), read as text: node compiles no GLSL, so what
// this can hold is what a compiler would refuse and what must be true of the words (`glslScan.ts` says why).
//
//   1. the real program, every include resolved, scanned for a name declared twice in one scope, with fog and
//      without, after checking the scanner finds one planted
//   2. the trees' sway: its shared uniforms and its functions present exactly once, a model's two uniforms
//      declared as plain globals the grass writes per tuft and never as uniforms, and the trees' chunk and the
//      card light's declarations the very same text as before they were cut (held to their hashes from before)
//   3. the client's curve carried back exactly once, the very lines the leaf cards run
//   2b. a quad of a fixed turn flipped to show its front to the eye, held against the tuft's own geometry
//   4. the material: one source for every world, the card light's and the sway's uniform objects shared by
//      reference, fog on, no light of three's, dry and kept out of the cascades; a tuft's mesh made with no depth
//      material casts nothing and never asks three to receive (the casting and receiving are `grassShadow.test`'s)
//   5. the world's wiring, read as text: pictures landing for a world that has gone are thrown away, and the
//      world's reaches are written whichever of the grass and the far cards is on
//
// Run: node tools/swg/tests/grassShader.test.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { CARD_CURVE_PARS, CARD_LIGHT_PARS, CARD_LIGHT_UNIFORMS } from '../../../src/world/cardLight.ts';
import { SWAY_UNIFORMS } from '../../../src/world/floraSway.ts';
import { GRASS_FRAGMENT, GRASS_UNIFORMS, GRASS_VERTEX, grassMaterial, grassStandIn, tuftMesh } from '../../../src/world/grass.ts';
import { tuftBuffers } from '../../../src/world/grassMath.ts';
import { SWAY_FUNCTIONS, SWAY_MODEL_PARS, SWAY_PARS, SWAY_SHARED_PARS } from '../../../src/world/swayMath.ts';
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
const count = (text: string, s: string) => text.split(s).length - 1;

// ---------------------------------------------------------------- 1. no name declared twice

ok(redeclared(`void f() { float a = 1.0; float a = 2.0; }`).includes('f: a'), 'the scope scan finds a name declared twice when one is planted');
for (const defs of [new Set<string>(), new Set(['USE_FOG']), new Set(['USE_FOG', 'FOG_EXP2'])]) {
  const v = redeclared(glslVariant(resolve(GRASS_VERTEX), defs));
  const f = redeclared(glslVariant(resolve(GRASS_FRAGMENT), defs));
  ok(v.length === 0 && f.length === 0, `no name is declared twice in one scope of the vertex or the fragment stage${defs.size ? ` with ${[...defs].join(' and ')}` : ' without fog'}${v.length || f.length ? `: ${[...v, ...f].join(', ')}` : ''}`);
}

// ---------------------------------------------------------------- 2. the trees' sway

// The trees' chunk and the card light's declarations held to the text they had before either was cut (SHA-256 of
// each as it stood at 8e16276, measured from that commit's own modules): a part that gained or lost so much as a
// newline at a join would change every tree's and every card's program key, and every one of them would be built
// again. A change made on purpose moves the hash here with it: the card light's moved with the performance pass's sixth
// wave, whose leaf skip takes each cascade's own depth range (`uSwgLeafRange` a vec4, `swgLeafBias` handed the
// cascade's index).
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
ok(sha(SWAY_PARS) === 'bd2f0e8473272e9cf9a6bd34e8ed6b97b253e09fc6d2b9c59ee8737db9a00eb8' && SWAY_PARS.length === 2205, `the trees' chunk is the very text it was before it was cut in three (sha-256 ${sha(SWAY_PARS).slice(0, 12)}, ${SWAY_PARS.length} characters)`);
ok(SWAY_PARS.includes('uniform vec2 uSwayFade;\nuniform vec4 uSwayShape;\nuniform vec4 uSwayAxis;\nfloat swgSwayHash(') && SWAY_PARS === SWAY_SHARED_PARS + SWAY_MODEL_PARS + SWAY_FUNCTIONS, 'and its three parts meet with one newline at each join, as the uncut chunk read');
ok(sha(CARD_LIGHT_PARS) === '3ed47f08c02fdbb3317f99148d532907446eddb6b47e83524ae2135705fb3e15' && CARD_LIGHT_PARS.length === 3470, `the card light's declarations are the very text they were before the curve was cut out of them (sha-256 ${sha(CARD_LIGHT_PARS).slice(0, 12)}, ${CARD_LIGHT_PARS.length} characters)`);
ok(CARD_LIGHT_PARS.includes(`varying vec3 vSwgStoredNormal;\n${CARD_CURVE_PARS}#endif\n`) && CARD_CURVE_PARS.startsWith('// Three\'s ACES fit carried back') && CARD_CURVE_PARS.endsWith('}\n'), 'and the curve sits in them where it always did, between the stored normal and the `#endif`');
ok(count(GRASS_VERTEX, SWAY_FUNCTIONS) === 1 && count(GRASS_VERTEX, SWAY_SHARED_PARS) === 1, 'the sway\'s functions and its shared uniforms are in the grass exactly once');
ok(count(GRASS_VERTEX, 'vec3 swgSwayOffset(') === 1 && count(GRASS_VERTEX, 'swgSwayOffset(') === 2, 'its one function, defined once and called once a vertex');
ok(!GRASS_VERTEX.includes('uniform vec4 uSwayShape') && !GRASS_VERTEX.includes('uniform vec4 uSwayAxis') && /\nvec4 uSwayShape;\nvec4 uSwayAxis;\n/.test(GRASS_VERTEX), 'a model\'s two are plain globals in the grass, written per tuft, never uniforms');
ok(/uSwayShape = vec4\(/.test(GRASS_VERTEX) && /uSwayAxis = vec4\(/.test(GRASS_VERTEX) && GRASS_VERTEX.indexOf('uSwayShape = vec4(') < GRASS_VERTEX.indexOf('swgSwayOffset( vec3('), 'and both are written before the call');

// ---------------------------------------------------------------- 2b. a fixed quad shows its front

{
  // The material draws one side, so a quad of a fixed turn (a crossed child's two, every tuft under the 'fixed'
  // knob) is flipped to show its front to the eye. The flip is held here against the tuft's own geometry: each of
  // its triangles, wound as its index winds it and placed by the vertex stage's own rule written out again, faces
  // an eye anywhere round it, from both quads of a crossed tuft, at any turn.
  const flip = 'if ( dot( cross( swgRight, swgUp ), SWG_GRASS_EYE - swgBase ) < 0.0 ) swgRight = - swgRight;';
  const at = GRASS_VERTEX.indexOf(flip);
  ok(count(GRASS_VERTEX, flip) === 1 && at > GRASS_VERTEX.indexOf('swgRight = swgAcross > 1e-5') && at < GRASS_VERTEX.indexOf('vec3 swgP = swgBase'), 'the vertex stage flips a quad\'s right toward the eye, once, after the right is made and before the corners are placed');
  const b = tuftBuffers(1);
  b.count = 1;
  const g = tuftMesh(b, grassMaterial()).geometry;
  const pos = g.getAttribute('position');
  const index = g.getIndex()!;
  const up = new THREE.Vector3(0, 1, 0);
  const base = new THREE.Vector3(3, 1, -2);
  const right = new THREE.Vector3();
  const toEye = new THREE.Vector3();
  const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  let faced = 0;
  let unflipped = 0;
  let all = 0;
  for (let y = 0; y < 12; y++) {
    const yaw = (y / 12) * Math.PI * 2 + 0.1;
    for (let a = 0; a < 24; a++) {
      const eye = new THREE.Vector3(base.x + 6 * Math.cos((a / 24) * Math.PI * 2), base.y + 1.5, base.z + 6 * Math.sin((a / 24) * Math.PI * 2));
      toEye.subVectors(eye, base);
      for (let t = 0; t < index.count; t += 3) {
        // The second quad (position z one) is the first turned a quarter.
        const second = pos.getZ(index.getX(t)) > 0.5;
        const quadYaw = yaw + (second ? Math.PI / 2 : 0);
        right.set(Math.cos(quadYaw), 0, -Math.sin(quadYaw));
        const before = e1.crossVectors(right, up).dot(toEye) >= 0;
        if (e1.crossVectors(right, up).dot(toEye) < 0) right.negate();
        for (let k = 0; k < 3; k++) {
          const v = index.getX(t + k);
          p[k].copy(base).addScaledVector(right, pos.getX(v)).addScaledVector(up, pos.getY(v));
        }
        e1.subVectors(p[1], p[0]);
        e2.subVectors(p[2], p[0]);
        all++;
        if (e1.cross(e2).dot(toEye) > 0) faced++;
        if (before) unflipped++;
      }
    }
  }
  ok(faced === all && unflipped < all * 0.6, `every triangle of a crossed tuft faces the eye from every side at every turn (${faced} of ${all}; ${all - unflipped} of them only because they were flipped)`);
}

// ---------------------------------------------------------------- 3. the curve

ok(count(GRASS_FRAGMENT, CARD_CURVE_PARS) === 1 && count(CARD_LIGHT_PARS, CARD_CURVE_PARS) === 1, 'the client\'s curve carried back is in the grass exactly once, the very lines the leaf cards carry');
ok(/swgAcesInverse\( swgCardToLinear\( swgDisplay \) \)/.test(GRASS_FRAGMENT) && /uSwgCardBloomCap/.test(GRASS_FRAGMENT), 'the display value is carried back and held under the bloom\'s threshold as a card\'s is');
ok(GRASS_FRAGMENT.indexOf('#include <tonemapping_fragment>') > GRASS_FRAGMENT.indexOf('gl_FragColor = vec4( swgColour'), 'and three\'s tone curve comes after it, which is what the carry is carried back through');

// ---------------------------------------------------------------- 4. the material and a tuft's mesh

const a = grassMaterial();
const b = grassMaterial();
ok(a.vertexShader === b.vertexShader && a.fragmentShader === b.fragmentShader && JSON.stringify(a.defines) === JSON.stringify(b.defines),'one source for every material made, so a world\'s grass needs no program of its own');
ok(a.uniforms.uSwgCardFront === CARD_LIGHT_UNIFORMS.uSwgCardFront && a.uniforms.uSwgLeafSun === CARD_LIGHT_UNIFORMS.uSwgLeafSun && a.uniforms.uSwgCardCurve === CARD_LIGHT_UNIFORMS.uSwgCardCurve, 'the card light\'s colours, sun and curve are the very uniform objects `updateCardLight` writes');
ok(a.uniforms.uSwayWind === SWAY_UNIFORMS.uSwayWind && a.uniforms.uSwayTime === SWAY_UNIFORMS.uSwayTime && a.uniforms.uSwayTune === SWAY_UNIFORMS.uSwayTune, 'and the sway\'s wind, clock and knobs the trees\' own');
ok(a.uniforms.uSwgGrassMap === GRASS_UNIFORMS.uSwgGrassMap && b.uniforms.uSwgGrassReach === GRASS_UNIFORMS.uSwgGrassReach, 'its own are the session\'s, shared by every material made');
ok(a.fog === true && a.lights === false && a.userData.dry === true && a.userData.unlit === true && (a as THREE.ShaderMaterial).isShaderMaterial, 'fog on, no light of three\'s, dry and kept out of the cascades');
ok(!/cameraPosition/.test(GRASS_FRAGMENT) && /cameraPosition/.test(GRASS_VERTEX), 'the eye read only in the vertex stage');
const buffers = tuftBuffers(2);
buffers.count = 2;
buffers.size.set([1, 1, 0, 0, 2, 3, 1, 1]);
buffers.tuft.set([0, 0, 0, 0, 10, 2, 5, 1]);
const mesh = tuftMesh(buffers, a);
ok(!mesh.castShadow && !mesh.receiveShadow && !mesh.customDepthMaterial && mesh.layers.mask === 1, 'a tuft\'s mesh made with no depth material casts nothing, never asks three to receive (it reads the cascades itself) and stands on layer 0 alone');
ok((mesh.geometry as THREE.InstancedBufferGeometry).instanceCount === 2 && mesh.geometry.boundingSphere!.containsPoint(new THREE.Vector3(10, 4.9, 5)), 'every tuft is drawn and its sphere holds every one, top and all');
const stand = grassStandIn(a);
ok(stand.material === a && (stand.geometry as THREE.InstancedBufferGeometry).instanceCount === 1 && stand.geometry.getAttribute('aSwgSway') !== undefined, 'the stand-in the loading screen compiles is a tuft drawn with the same material and every attribute');

// ---------------------------------------------------------------- 5. the world's wiring, read as text

{
  // `World` cannot be built in node, so how it hands the grass a world is read off its own words.
  const worldTs = readFileSync(new URL('../../../src/world/world.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const mainTs = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const start = worldTs.indexOf('private async loadGrass(');
  const body = worldTs.slice(start, worldTs.indexOf('\n  }\n', start));
  const token = body.indexOf('const token = this.loadToken;');
  const fetch = body.indexOf('await loadRadialPack(');
  const guard = body.indexOf('if (token !== this.loadToken)');
  const first = Math.min(...['setGrassPictures(', 'this.grassPictures =', 'initTexture(', '.setWorld('].map((s) => body.indexOf(s)).filter((i) => i >= 0));
  ok(start > 0 && token >= 0 && token < fetch && fetch < guard && guard < first && /if \(token !== this\.loadToken\) \{\s*loaded\.texture\.dispose\(\);\s*return;/.test(body), 'a world\'s pictures that land after a travel or a leave are thrown away before anything of them is kept, as the lava\'s are');
  const write = body.indexOf('writeGrassUniforms(setup);');
  const line = body.slice(body.lastIndexOf('\n', write), write);
  ok(write > body.indexOf('this.farCards.setWorld(setup)') && !/if \(/.test(line), 'the world\'s reaches go into the uniforms whichever of the grass and the far cards is on');
  ok(/grass: \(opts[\s\S]{0,900}writeGrassUniforms\(this\.world\.grassWorld\)/.test(mainTs) && /farCards: \(opts[\s\S]{0,500}writeGrassUniforms\(this\.world\.grassWorld\)/.test(mainTs) && !/writeGrassUniforms\(this\.world\.grass\?\.world/.test(mainTs), 'and both knobs write them from whichever of the two holds the world, so the far cards alone keep their world\'s reach');
}

console.log(`\n${passed} passed`);
