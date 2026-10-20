// A held cascade is one cascade (the performance pass's sixth wave, src/world/shadowCadence.ts): three's real `CSM` in
// node with the game's camera and cascades, its three lights and their targets in a scene. Each cascade's map is drawn at
// a pose (recorded as `ShadowHold.drawn` records it); the camera moves a little; `csm.update()` fits every light afresh;
// `decide` holds the far ones; `refreshCascadeBoxes` works every matrix out: the held cascade's `shadow.matrix` (what the
// receivers read), its camera's `matrixWorldInverse` and its frustum (what the bodies' casting is tested against) are
// element for element what they were when its map was drawn, and the near cascade, due every frame, takes the fresh fit.
// The order is the whole of it, so the same frame with `refreshCascadeBoxes` before `decide` is shown to be wrong.
//
// Synthetic: the game's camera and cascade numbers, nothing read from the game's files.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { SHADOW_PASS_TUNE, ShadowHold, ShadowMovers, shadowCameraFar } from '../../../src/world/shadowCadence.ts';
import { reachesCascades, refreshCascadeBoxes } from '../../../src/world/bodyCull.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const camera = new THREE.PerspectiveCamera(60, 1600 / 900, 0.05, 9000);
const scene = new THREE.Scene();
const csm = new CSM({ camera, parent: scene, cascades: 3, maxFar: 320, mode: 'practical', shadowMapSize: 2048, lightDirection: new THREE.Vector3(0.3, -1, 0.2).normalize(), lightIntensity: 2, lightMargin: 150, lightNear: 1, lightFar: 470 });
csm.fade = true;
csm.updateFrustums();
const lights = csm.lights;
for (const l of lights) {
  l.shadow.camera.near = 1;
  // The depth the game ships (`farDepth` 'whole', the owner's Q8), worked out by the game's own formula.
  l.shadow.camera.far = shadowCameraFar('whole', 150, 320, l.shadow.camera.right - l.shadow.camera.left);
  l.shadow.camera.updateProjectionMatrix();
  // Three makes the map at a light's first draw; a stand-in says each has one.
  l.shadow.map = {} as THREE.WebGLRenderTarget;
}
csm.lightDirection.copy(new THREE.Vector3(0.83, 0.51, -0.21).normalize()).negate();
const boxes: THREE.Frustum[] = [];
const hold = new ShadowHold();
hold.bind(lights);
const movers = new ShadowMovers();
const pose = (yaw: number, z: number): void => {
  camera.position.set(0, 1.8, z);
  camera.rotation.set(-0.15, yaw, 0, 'YXZ');
  camera.updateMatrixWorld();
};
/** One frame as `World.updateShadows` runs it, then three's draw of whatever is due, then `drawn`. */
const frame = (now: number): void => {
  csm.update();
  hold.decide(lights, csm, camera, now, movers);
  refreshCascadeBoxes(lights, boxes);
  for (const l of lights) if (l.shadow.autoUpdate) l.shadow.needsUpdate = false;
  hold.drawn(lights, true, false);
};

// Every cascade drawn fresh at a pose; what each was drawn with kept.
SHADOW_PASS_TUNE.maxAgeMs.splice(0, SHADOW_PASS_TUNE.maxAgeMs.length, 0, 1e6, 1e6);
pose(0.4, 0);
hold.dirtyAll();
frame(1000);
const drawnMatrix = lights.map((l) => l.shadow.matrix.clone());
const drawnInverse = lights.map((l) => l.shadow.camera.matrixWorldInverse.clone());
const drawnPlanes = boxes.map((f) => f.planes.map((p) => [p.normal.x, p.normal.y, p.normal.z, p.constant]));
ok(hold.reason.slice(0, 3).every((r) => r === 'first'), 'with no map drawn yet every cascade is drawn (first)');

// The camera moves a little: a fresh fit would move every light.
pose(0.405, -0.1);
csm.update();
const freshPositions = lights.map((l) => l.position.clone());
pose(0.4, 0);
csm.update();
pose(0.405, -0.1);
frame(1010);
ok(hold.reason[0] === 'age' && hold.reason[1] === 'held' && hold.reason[2] === 'held', `the near cascade is drawn and the far two held (${hold.reason.slice(0, 3).join(' ')})`);
const same = (a: THREE.Matrix4, b: THREE.Matrix4): boolean => a.elements.every((v, i) => v === b.elements[i]);
ok(same(lights[1].shadow.matrix, drawnMatrix[1]) && same(lights[2].shadow.matrix, drawnMatrix[2]), "each held cascade's shadow.matrix, which the receivers read by reference, is element for element the one its map was drawn with");
ok(same(lights[1].shadow.camera.matrixWorldInverse, drawnInverse[1]) && same(lights[2].shadow.camera.matrixWorldInverse, drawnInverse[2]), "and so is its shadow camera's matrixWorldInverse");
const planesNow = boxes.map((f) => f.planes.map((p) => [p.normal.x, p.normal.y, p.normal.z, p.constant]));
ok(JSON.stringify(planesNow[1]) === JSON.stringify(drawnPlanes[1]) && JSON.stringify(planesNow[2]) === JSON.stringify(drawnPlanes[2]), 'and its frustum, the one the bodies\' casting is tested against');
ok(lights[0].position.equals(freshPositions[0]) && !same(lights[0].shadow.matrix, drawnMatrix[0]), 'the near cascade, due, takes the fresh fit');
ok(!lights[1].position.equals(freshPositions[1]) || !lights[2].position.equals(freshPositions[2]), 'the fresh fit had moved the held lights (so the hold is what kept them)');
// The frustum `reachesCascades` is handed is the held one: on every sphere where the box the far map was drawn with and
// this frame's fresh fit answer differently, the boxes `refreshCascadeBoxes` filled answer as the drawn one.
{
  const freshLight = new THREE.DirectionalLight();
  freshLight.shadow.camera.copy(lights[2].shadow.camera);
  freshLight.position.copy(freshPositions[2]);
  freshLight.target.position.copy(freshPositions[2]).add(csm.lightDirection);
  freshLight.updateMatrixWorld();
  freshLight.target.updateMatrixWorld();
  freshLight.shadow.updateMatrices(freshLight);
  const freshBox = new THREE.Frustum().copy(freshLight.shadow.getFrustum());
  // The box the far map was drawn with, made again from the planes kept when it was drawn: a frustum of its own.
  const drawnBox = new THREE.Frustum();
  drawnPlanes[2].forEach(([x, y, z, c], i) => drawnBox.planes[i].set(new THREE.Vector3(x, y, z), c));
  const s = new THREE.Sphere(new THREE.Vector3(), 1);
  let differ = 0;
  let followsDrawn = 0;
  for (let x = -600; x <= 600; x += 4) {
    for (let z = -600; z <= 600; z += 4) {
      s.center.set(x, 0, z);
      if (drawnBox.intersectsSphere(s) === freshBox.intersectsSphere(s)) continue;
      differ++;
      if (reachesCascades([boxes[2]], s) === drawnBox.intersectsSphere(s)) followsDrawn++;
    }
  }
  ok(differ > 0, `there are spheres the far map's drawn box and this frame's fresh fit answer differently (${differ}), so the check below can fail`);
  ok(followsDrawn === differ, `on every one of them the boxes refreshCascadeBoxes filled answer as the box the far map was drawn with, never the fresh fit (${followsDrawn} of ${differ})`);
}

// The order is the point: with the matrices worked out before the hold puts the lights back, a held cascade's matrix is
// this frame's fit's, which its map was not drawn with.
{
  const h2 = new ShadowHold();
  h2.bind(lights);
  pose(0.4, 0);
  h2.dirtyAll();
  csm.update();
  h2.decide(lights, csm, camera, 2000, movers);
  refreshCascadeBoxes(lights, boxes);
  for (const l of lights) l.shadow.needsUpdate = false;
  h2.drawn(lights, true, false);
  const m2 = lights[2].shadow.matrix.clone();
  pose(0.405, -0.1);
  csm.update();
  refreshCascadeBoxes(lights, boxes);
  const wrong = lights[2].shadow.matrix.clone();
  h2.decide(lights, csm, camera, 2010, movers);
  ok(h2.reason[2] === 'held' && !same(wrong, m2), 'worked out before the hold, a held cascade\'s matrix is this frame\'s fit\'s and not the one its map was drawn with');
}

// A draw no `decide` preceded draws what was last due and skips only what was held: autoUpdate per light stays as decide left it.
{
  pose(0.405, -0.1);
  frame(3000);
  const auto = lights.map((l) => l.shadow.autoUpdate);
  ok(auto[0] === true && auto[1] === false && auto[2] === false, `between decisions each light's autoUpdate is what the last decision wrote (${auto.join(' ')})`);
  hold.dirtyAll();
  ok(lights.every((l) => l.shadow.autoUpdate), '`dirtyAll` sets every light\'s autoUpdate, so a cascade is due wherever the next draw comes from');
  hold.drawn(lights, false, false);
  frame(3010);
  ok(hold.reason.slice(0, 3).every((r) => r === 'dirty'), 'a frame with no shadow pass draws every cascade whole on the next');
}

SHADOW_PASS_TUNE.maxAgeMs.splice(0, SHADOW_PASS_TUNE.maxAgeMs.length, 0, 13, 41);
void scene;
console.log(`\n${checks} checks passed`);
