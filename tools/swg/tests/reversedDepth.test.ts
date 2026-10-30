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

console.log(`\nreversedDepth: ${passed} checks passed`);
process.exit(0);
