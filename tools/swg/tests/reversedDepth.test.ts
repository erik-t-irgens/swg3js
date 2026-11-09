// Reversed depth's guards (docs/REVERSED-DEPTH.md), run against three's own code so an upgrade that changes what they
// work around fails here, by name, rather than on screen. With no document node draws with ordinary depth, so the
// texts are checked as they always were; reversedDepthOn.test.ts checks them turned round.
//
//   1. the draw order: three reverses each whole sorted list under reversed depth (WebGLRenderLists.sort), renderOrder
//      and all; reversedSort.ts's comparators, put through three's real list and its reversal, give renderOrder rising,
//      opaque things nearest first and see-through things farthest first -- the sky's dome first, as it must be
//   2. the cascades: three's CSM, with a reversed camera, collapses its frustum; csmDepth.ts's followCameraDepth gives
//      it the camera's whole depth, reversed or not
//   3. the depth-test table: three maps Always to Never under reversed depth; the doorway reset's choice
//      (portalRender.ts, alwaysDepthFunc, which asks the GPU) comes out Always whichever way three's table goes
//   4. behind the camera: projectedBehind with real cameras, ordinary and reversed
//   5. with reversed depth off, every chosen text is what it always was
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { WebGLRenderLists } from 'three/src/renderers/webgl/WebGLRenderLists.js';
import { ReversedDepthFuncs } from 'three/src/utils.js';
import { reversedOpaqueSort, reversedTransparentSort } from '../../../src/core/reversedSort.ts';
import { followCameraDepth } from '../../../src/world/csmDepth.ts';
import { projectedBehind, REVERSED_DEPTH } from '../../../src/core/depthMode.ts';
import { FX_LINEARIZE, pastFarTest, skyTest } from '../../../src/core/fx/glsl.ts';
import { GRASS_FRAGMENT, grassForDepthMode } from '../../../src/world/grass.ts';
import { readFileSync } from 'node:fs';
import { FAR_BASE, HORIZON_TUNE, RAYS_GROUND_SKY, SEA_BASE, SKY_BASE, SKY_SHELLS, newReachRules, reachRules, ringReach } from '../../../src/world/horizon/horizonMath.ts';
import { HorizonFollow } from '../../../src/world/horizon/horizonSea.ts';
import { SKY_SHARE } from '../../../src/core/fx/flareMath.ts';
import { GROUND_SKY } from '../../../src/core/fx/context.ts';

let passed = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  passed++;
};

// --- 1. the draw order through three's real list ---
{
  // One scene, sorted twice by three's real list: with an ordinary camera and three's own comparators, and with a
  // reversed camera, reversedSort.ts's comparators and three's reversal. The two orders must be the same.
  const cameraOf = (reversed: boolean): THREE.PerspectiveCamera => {
    const c = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 9000);
    (c as unknown as { _reversedDepth: boolean })._reversedDepth = reversed;
    c.updateProjectionMatrix();
    return c;
  };
  const geo = new THREE.BufferGeometry();
  const shared = new THREE.MeshBasicMaterial();
  const sharedSee = new THREE.MeshBasicMaterial({ transparent: true });
  // name, renderOrder, metres out, see-through, own material (else one shared, so distance decides among them)
  const scene: [string, number, number, boolean, boolean][] = [
    ['dome', -10, 5600, false, true], ['planet stand-in', -3, 5000, false, true],
    ['rock 50 m', 0, 50, false, false], ['player 4 m', 0, 4, false, false], ['terrain 200 m', 0, 200, false, false],
    ['crate 20 m', 0, 20, false, true], ['wall 8 m', 0, 8, false, true],
    ['stars', -5, 5500, true, true], ['planet', -4, 5000, true, true],
    ['glass 10 m', 0, 10, true, false], ['smoke 100 m', 0, 100, true, false],
  ];
  const own = scene.map(([, , , see]) => new THREE.MeshBasicMaterial({ transparent: see }));
  const order = (reversed: boolean): { opaque: string; seeThrough: string } => {
    const camera = cameraOf(reversed);
    const projScreen = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const list = new WebGLRenderLists().get(new THREE.Scene(), 0);
    list.init();
    scene.forEach(([name, renderOrder, at, see, ownMaterial], i) => {
      const material = ownMaterial ? own[i] : see ? sharedSee : shared;
      const mesh = new THREE.Mesh(geo, material);
      mesh.name = name;
      mesh.renderOrder = renderOrder;
      // z as three works it out for the sort (WebGLRenderer.projectObject).
      list.push(mesh, geo, material, 0, new THREE.Vector3(0, 0, -at).applyMatrix4(projScreen).z, null);
    });
    if (reversed) list.sort(reversedOpaqueSort, reversedTransparentSort, true);
    else list.sort(null, null, false);
    const names = (items: { object: THREE.Object3D }[]): string => items.map((r) => r.object.name).join(' > ');
    return { opaque: names(list.opaque), seeThrough: names(list.transparent) };
  };
  const ordinary = order(false);
  const reversed = order(true);
  const why = 'under reversed depth the draw order differs from ordinary depth; three may have stopped reversing its sorted lists (WebGLRenderLists.sort), and reversedSort.ts must follow, or the sky covers the world';
  ok(reversed.opaque === ordinary.opaque, `opaque: reversed ${reversed.opaque}, ordinary ${ordinary.opaque}: ${why}`);
  ok(reversed.seeThrough === ordinary.seeThrough, `see-through: reversed ${reversed.seeThrough}, ordinary ${ordinary.seeThrough}: ${why}`);
  ok(reversed.opaque.startsWith('dome > planet stand-in'), 'the dome is drawn first, the planets\' depth after it');
  ok(reversed.opaque.includes('player 4 m > rock 50 m > terrain 200 m'), 'among one material, nearest first');
  ok(reversed.seeThrough.startsWith('stars > planet') && reversed.seeThrough.includes('smoke 100 m > glass 10 m'), 'stars before planets, then farthest first');
  // And three's own order, unaided, is what the comparators are there for: the dome last.
  const unaided = new WebGLRenderLists().get(new THREE.Scene(), 0);
  unaided.init();
  const dome = new THREE.Mesh(geo, own[0]);
  dome.name = 'dome';
  dome.renderOrder = -10;
  const rock = new THREE.Mesh(geo, shared);
  rock.name = 'rock';
  unaided.push(dome, geo, own[0], 0, 0.00001, null);
  unaided.push(rock, geo, shared, 0, 0.001, null);
  unaided.sort(null, null, true);
  ok(unaided.opaque[unaided.opaque.length - 1].object.name === 'dome', 'three, unaided, still draws the dome last under reversed depth (if not, reversedSort.ts may be retired)');
}

// --- 2. the cascades' frustum ---
{
  const cascades = (reversed: boolean): { csm: CSM; camera: THREE.PerspectiveCamera } => {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 9000);
    (camera as unknown as { _reversedDepth: boolean })._reversedDepth = reversed;
    camera.updateProjectionMatrix();
    const csm = new CSM({ camera, parent: new THREE.Scene(), cascades: 3, maxFar: 800, mode: 'practical' });
    return { csm, camera };
  };
  const far = (csm: CSM): number => -(csm.mainFrustum as unknown as { vertices: { far: THREE.Vector3[] } }).vertices.far[0].z;
  const near = (csm: CSM): number => -(csm.mainFrustum as unknown as { vertices: { near: THREE.Vector3[] } }).vertices.near[0].z;
  const rev = cascades(true);
  ok(far(rev.csm) < 1, `three's CSM, unaided, collapses a reversed camera's frustum (far corner ${far(rev.csm).toFixed(2)} m); if it no longer does, csmDepth.ts may be retired`);
  followCameraDepth(rev.csm, rev.camera);
  ok(Math.abs(far(rev.csm) - 800) < 1e-3 && Math.abs(near(rev.csm) - 0.05) < 1e-6, `followed: the reversed camera's frustum spans ${near(rev.csm)} to ${far(rev.csm)} m`);
  rev.csm.updateFrustums();
  ok(Math.abs(far(rev.csm) - 800) < 1e-3, 'and every later split keeps it (a new location, a shadow setting)');
  const ord = cascades(false);
  followCameraDepth(ord.csm, ord.camera);
  ok(Math.abs(far(ord.csm) - 800) < 1e-3 && Math.abs(near(ord.csm) - 0.05) < 1e-6, 'an ordinary camera is split as three always split it');
}

// --- 3. the depth-test table ---
{
  const table = ReversedDepthFuncs as Record<number, number>;
  // What alwaysDepthFunc picks from the GPU's answer, modelled on the table: the test that comes out Always.
  const chosen = table[THREE.AlwaysDepth] === THREE.AlwaysDepth ? THREE.AlwaysDepth : THREE.NeverDepth;
  ok(table[chosen] === THREE.AlwaysDepth, 'the doorway reset asks for the test that three turns into Always');
  if (table[THREE.AlwaysDepth] !== THREE.NeverDepth) console.log('note: three now maps Always to itself under reversed depth; alwaysDepthFunc asks for Always again by itself');
  ok(table[THREE.LessEqualDepth] === THREE.GreaterEqualDepth, 'less-equal still turns into greater-equal, as every ordinary material relies on');
}

// --- 4. behind the camera ---
{
  for (const reversed of [false, true]) {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 9000);
    (camera as unknown as { _reversedDepth: boolean })._reversedDepth = reversed;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const ahead = new THREE.Vector3(3, 1, -40).project(camera);
    const behind = new THREE.Vector3(3, 1, 40).project(camera);
    const pastFar = new THREE.Vector3(0, 0, -12000).project(camera);
    const label = reversed ? 'reversed' : 'ordinary';
    ok(!projectedBehind(ahead.z, camera), `${label}: a target ahead is not behind`);
    ok(projectedBehind(behind.z, camera), `${label}: a target behind is behind (its box must not be drawn mirrored in front)`);
    ok(projectedBehind(pastFar.z, camera), `${label}: past the far plane counts as behind, as before`);
  }
}

// --- 5. off, every chosen text as it always was ---
{
  ok(REVERSED_DEPTH === false, 'node, with no document, draws with ordinary depth');
  ok(FX_LINEARIZE.includes('float ndcZ = depth * 2.0 - 1.0;'), 'fxViewZ is the ordinary one');
  ok(skyTest('d') === 'd >= 1.0' && pastFarTest('sc.z') === 'sc.z > 1.0', 'the sky and far-end tests read as they always did');
  ok(grassForDepthMode(GRASS_FRAGMENT) === GRASS_FRAGMENT, "the grass's text is untouched");
}

// --- 6. the far ground's reach and what follows it (the horizon pass's fifth wave, DESIGN.md §2.6, §7) ---
{
  const t = { ...HORIZON_TUNE };
  const rules = newReachRules();
  const ask = (reach: number, eyeOver: number, reversed: boolean, fog = 0, o: Partial<typeof HORIZON_TUNE> = {}) => {
    Object.assign(t, HORIZON_TUNE, o, { reach });
    rules.fogDensity = fog;
    rules.eyeOver = eyeOver;
    rules.bakeMost = Infinity;
    return reachRules(t, 6, reversed, rules);
  };
  // Today's numbers, with the rings not drawn: every reader holds them by Object.is whatever the tune says.
  const f = new HorizonFollow();
  for (const k of ['heightReach', 'skyMargin', 'farMargin', 'farStep', 'fade']) (HORIZON_TUNE as Record<string, unknown>)[k] = 99;
  f.base();
  ok(Object.is(f.far, 9000) && Object.is(f.sky, 3500) && Object.is(f.groundSky, 2500) && Object.is(f.flareSky, 3500) && Object.is(f.sea, 9000) && !f.on, "with no rings every reader holds today's far plane 9,000, sky 3,500, rays' ground sky 2,500, flare's sky 3,500 and far sea 9,000 (Object.is), whatever the tune");
  Object.assign(HORIZON_TUNE, t);
  ok(FAR_BASE === 9000 && SKY_BASE === 3500 && RAYS_GROUND_SKY === 2500 && SEA_BASE === 9000, 'and the constants are the very numbers the readers held');
  // Every sky element (sky.ts's multiples of SKY_RADIUS, read from its own text) beyond the reach at every reach and height,
  // the far plane past the dome, the fog never moving the far plane, under reversed depth.
  const skyText = readFileSync(new URL('../../../src/world/sky.ts', import.meta.url), 'utf8');
  ok(/SphereGeometry\(SKY_RADIUS \* 1\.6,/.test(skyText) && /SKY_RADIUS \* 1\.5/.test(skyText) && /SKY_RADIUS \* 1\.2/.test(skyText) && /multiplyScalar\(SKY_RADIUS\)/.test(skyText) && SKY_SHELLS.join() === '1,1.2,1.5,1.6', "the sky's shells are sky.ts's own multiples (the bodies 1, stars 1.2, skybox 1.5, dome 1.6)");
  let worst = Infinity;
  let farOk = true;
  let fogMoved = false;
  for (const reach of [1000, 3000, 4900, 8000, 12000, 16000, 32000])
    for (const h of [0, 1.7, 40, 500, 2000, 6000]) {
      // Each ask from a fresh record: the far step's hold would otherwise keep the clear ask's step for the foggy one.
      Object.assign(rules, newReachRules());
      const r = ask(reach, h, true);
      const far = r.far;
      const sky = r.skyRadius;
      for (const s of SKY_SHELLS) worst = Math.min(worst, s * sky - r.grown);
      if (!(far > SKY_SHELLS[3] * sky) || !(r.inForce <= r.grown) || !(r.grown <= r.farReach)) farOk = false;
      Object.assign(rules, newReachRules());
      const thick = ask(reach, h, true, 0.002);
      if (thick.far !== far || thick.skyRadius !== sky) fogMoved = true;
    }
  ok(worst > 0, `every depth-tested sky element stands past the grown reach at every reach and height (the nearest ${worst.toFixed(0)} m past it)`);
  ok(farOk, 'the far plane stands past the dome (1.6 of the sky), and the reach in force inside the grown reach inside its step');
  ok(!fogMoved, "the fog's cap never moves the far plane or the sky (it trims the reach in force alone)");
  // Q10: the reach grows with the eye's height, held under the slider's top (or the console's reach past it) and the bake.
  // (One kept record answers every ask: each answer is read before the next.)
  const onFoot = ask(8000, 1.7, true).grown;
  const ship = ask(8000, 2000, true);
  ok(onFoot < 8010 && Math.abs(ship.grown - 16000) < 1e-9 && ship.inForce === 16000, `a ship 2 km up sees ${ship.grown} m where the eye on foot sees ${onFoot.toFixed(1)} m`);
  ok(ask(8000, 20000, true).grown === 16000 && ask(20000, 20000, true).grown === 20000, "held under the slider's top, and the console's reach past it is never cut");
  rules.bakeMost = 9000;
  rules.eyeOver = 2000;
  rules.fogDensity = 0;
  ok(reachRules({ ...HORIZON_TUNE, reach: 8000 }, 6, true, rules).grown === 9000, "and under the bake's own extent from the eye");
  ok(ask(8000, 2000, false).grown === 4900 && ask(8000, 2000, false).far === Math.max(9000, Math.ceil(4900 / HORIZON_TUNE.farStep) * HORIZON_TUNE.farStep * HORIZON_TUNE.skyMargin * HORIZON_TUNE.farMargin), 'without reversed depth the reach stays 4.9 km at any height');
  ok(ask(8000, 2000, true, 0, { heightReach: 0 }).grown === 8000, 'a growth of nought is the slider at any height');
  // The far plane's steps: a step crossed moves it, a fall of under a step and a quarter keeps it, a height dancing on a line keeps it.
  const steps: number[] = [];
  Object.assign(rules, newReachRules());
  for (const h of [0, 10, 120, 126, 124, 126, 124, 50, 0, 300, 120]) steps.push(ask(8000, h, true).farReach);
  ok(steps.join() === '8000,8500,8500,9000,9000,9000,9000,8500,8500,9500,8500',`the far plane's reach moves only past a step and back past a step and a quarter (${steps.join(', ')})`);
  // The god rays' and the flare's sky (§2.6, §12 Q3): R (1 - fade / 2) with raysBlock, the flare's depth as lensFlare.ts reads it.
  const r = ask(8000, 1.7, true);
  const want = r.inForce * (1 - HORIZON_TUNE.fade / 2);
  const flareDepth = Math.max(1, Math.min(r.flareSky, r.far) * SKY_SHARE);
  ok(Math.abs(r.groundSky - want) < 1e-9 && Math.abs(flareDepth - want) < 1e-6, `with raysBlock the rays' ground sky and the flare's sky depth stand at R (1 - fade / 2) = ${want.toFixed(0)} m`);
  const off = ask(8000, 1.7, true, 0, { raysBlock: false });
  ok(Object.is(off.groundSky, 2500) && off.flareSky === off.skyRadius, "without it, the old 2,500 m and the sky's radius");
  ok(ask(8000, 1.7, true, 0, { fadeTo: 'none' }).groundSky === ask(8000, 1.7, true).inForce, 'with no fade the ridge at the reach is solid to the reach itself');
  // No ring vertex past the reach in force: the ring's clamp (its mirror) holds every vertex inside it.
  let past = 0;
  for (let k = 0; k < 2000; k++) {
    const dx = (k * 7919) % 40000 - 20000;
    const dz = (k * 104729) % 40000 - 20000;
    const kk = ringReach(dx, dz, r.inForce);
    if (Math.hypot(dx * kk, dz * kk) > r.inForce * (1 + 1e-9)) past++;
  }
  ok(past === 0, 'no ring vertex stands past the reach in force');
  // The effects: a frame from before the wave hands no ground sky and reads today's; the rays read the frame's.
  const ctxText = readFileSync(new URL('../../../src/core/fx/context.ts', import.meta.url), 'utf8');
  const passText = readFileSync(new URL('../../../src/core/fx/passes.ts', import.meta.url), 'utf8');
  ok(GROUND_SKY === 2500 && /ctx\.groundSky = input\.groundSky !== undefined \? input\.groundSky : GROUND_SKY;/.test(ctxText) && passText.includes('u.uSkyDistance.value = skyDistanceFor(ctx.space, ctx.far, ctx.groundSky);'), "the god rays read the frame's ground sky, 2,500 m where a frame hands none");
  ok(skyText.includes('o.skyDistance = this.flareSkyDistance;') && skyText.includes('this.flareSkyDistance = SKY_RADIUS;'), "the flare reads the sky's own flare distance, SKY_RADIUS until the world moves it");
}

console.log(`\nreversedDepth: ${passed} checks passed`);
process.exit(0);
