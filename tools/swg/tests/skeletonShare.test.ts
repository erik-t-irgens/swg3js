// A body's skeletons and its per-mesh cull (step 3 of the frame-time wave), with three in node over made-up
// bodies: a model of three skinned meshes over one skeleton clones to one skeleton (`cloneShared`) with the
// clone's own bones and the model's inverses, and to three with the switch off; a body already hung is
// flipped both ways and back (`reshareSkeletons`), a skeleton no mesh stands on letting its bone texture go;
// the once-a-frame rule (`skeletonOnce.ts`) recomputing nothing on a second update inside an open frame, and
// everything outside one or with the switch off, and the frame report counting the skip; each skinned mesh's
// sphere, set once in its own frame (`fitCullSpheres`), agreeing with the manager's group sphere over 200
// random cameras once the body is moved, turned and scaled, and holding it at every camera with the grown
// sphere; a mesh under a bone given no sphere and a rigid one keeping its geometry's; a fighter's sphere;
// the switch's cull, and no cull for a body off its feet (a ragdoll, dead in its clip, knocked down, prone,
// or in an idle lying at full length, `cullsOneByOne`); a creature's shadow decided by three's own shadow
// cascades' light boxes (`refreshCascadeBoxes`, `reachesCascades`, `lodTier`), including the body at the side
// of the view and the one past the last cascade with a low sun ahead; and the wiring, read as text.
//
// Everything here is synthetic: numbers chosen for this test, nothing read from the game's files.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { cloneShared, reshareSkeletons } from '../../../src/world/mobiles/cloneShared.ts';
import { beginSkeletonFrame, endSkeletonFrame, installSkeletonOnce, SKELETON_FRAME, SKELETON_TUNE } from '../../../src/core/skeletonOnce.ts';
import { cullsOneByOne, fighterCull, fitCullSpheres, frameOf, LYING_IDLE, reachesCascades, refreshCascadeBoxes, setBodyCulled, type BodyPose } from '../../../src/world/bodyCull.ts';
import { CNT, PERF, perf } from '../../../src/core/perf.ts';
import { LOD_TUNE, lodTier, type LodInput } from '../../../src/world/mobiles/lod.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** A small random generator of our own, so every run draws the same cameras. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A made-up body: a root, a spine of three bones, and `parts` skinned meshes over one skeleton, as the loader gives a model with one skin. */
function makeBody(parts = 3): { root: THREE.Group; bones: THREE.Bone[]; skeleton: THREE.Skeleton; meshes: THREE.SkinnedMesh[] } {
  const root = new THREE.Group();
  root.name = 'model';
  const hips = new THREE.Bone();
  hips.name = 'hips';
  hips.position.set(0, 0.9, 0);
  const spine = new THREE.Bone();
  spine.name = 'spine';
  spine.position.set(0, 0.4, 0);
  const head = new THREE.Bone();
  head.name = 'head';
  head.position.set(0, 0.5, 0);
  hips.add(spine);
  spine.add(head);
  // A node between the root and the meshes with a turn and a size of its own, as a converted model has.
  const armature = new THREE.Group();
  armature.name = 'armature';
  armature.rotation.set(0.2, -0.4, 0.1);
  armature.scale.setScalar(1.3);
  armature.position.set(0.1, 0.05, -0.2);
  root.add(armature);
  armature.add(hips);
  root.updateMatrixWorld(true);
  const bones = [hips, spine, head];
  const skeleton = new THREE.Skeleton(bones);
  const meshes: THREE.SkinnedMesh[] = [];
  for (let p = 0; p < parts; p++) {
    const g = new THREE.BoxGeometry(0.4, 1.8, 0.3, 1, 3, 1);
    g.translate(0, 0.9, 0);
    const n = g.attributes.position.count;
    const idx = new Uint16Array(n * 4);
    const w = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      idx[i * 4] = Math.min(2, Math.floor(g.attributes.position.getY(i) / 0.7));
      w[i * 4] = 1;
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(w, 4));
    const mesh = new THREE.SkinnedMesh(g, new THREE.MeshBasicMaterial());
    mesh.name = `part${p}`;
    mesh.position.set(0.02 * p, 0, 0);
    armature.add(mesh);
    mesh.updateMatrixWorld(true);
    mesh.bind(skeleton);
    meshes.push(mesh);
  }
  return { root, bones, skeleton, meshes };
}

function skinnedUnder(root: THREE.Object3D): THREE.SkinnedMesh[] {
  const out: THREE.SkinnedMesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) out.push(o as THREE.SkinnedMesh);
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Commit 3a: the shared clone.
{
  const { root, skeleton } = makeBody(3);
  const clone = cloneShared(root, true);
  const cm = skinnedUnder(clone);
  const skeletons = new Set(cm.map((m) => m.skeleton));
  ok(cm.length === 3 && skeletons.size === 1, 'a model of three skinned meshes over one skeleton clones to one skeleton');
  const cs = cm[0].skeleton;
  ok(cs !== skeleton, "and it is the clone's own, not the model's");
  const cloneBones: THREE.Bone[] = [];
  clone.traverse((o) => {
    if ((o as THREE.Bone).isBone) cloneBones.push(o as THREE.Bone);
  });
  ok(cs.bones.length === 3 && cs.bones.every((b) => cloneBones.includes(b)) && cs.bones.every((b) => !skeleton.bones.includes(b)), "its bones are the clone's bones, in the model's order");
  ok(cs.boneInverses.length === skeleton.boneInverses.length && cs.boneInverses.every((m, i) => m.equals(skeleton.boneInverses[i])), "its inverses are the model's");
  ok(cm.every((m, i) => m.bindMatrix.equals(skinnedUnder(root)[i].bindMatrix)), 'each mesh keeps its own bind matrix');
  const each = cloneShared(root, false);
  ok(new Set(skinnedUnder(each).map((m) => m.skeleton)).size === 3, "with the switch off three's own clone gives each mesh a skeleton of its own");
  // The clone draws where the model does: the same posed vertex from both.
  root.updateMatrixWorld(true);
  clone.updateMatrixWorld(true);
  skeleton.update();
  cs.update();
  const a = skinnedUnder(root)[1].getVertexPosition(5, new THREE.Vector3());
  const b = cm[1].getVertexPosition(5, new THREE.Vector3());
  ok(a.distanceTo(b) < 1e-6, 'a vertex of the shared clone is where the same vertex of the model is');

  // A body already hung flipped both ways, as the frame report's A/B flips it.
  const n0 = reshareSkeletons(clone, false);
  const alone = skinnedUnder(clone).map((m) => m.skeleton);
  ok(n0 === 3 && new Set(alone).size === 3 && alone.every((s) => s.boneInverses === cs.boneInverses), 'flipped off, every mesh stands on a skeleton of its own over the same bones and inverses');
  alone[2].computeBoneTexture();
  const tex = alone[2].boneTexture;
  let freed = false;
  tex?.addEventListener('dispose', () => (freed = true));
  const n1 = reshareSkeletons(clone, true);
  ok(n1 === 1 && new Set(skinnedUnder(clone).map((m) => m.skeleton)).size === 1, 'flipped back on, one skeleton again');
  ok(freed && alone[2].boneTexture === null, 'and a skeleton no mesh stands on has let its bone texture go');
  ok(reshareSkeletons(clone, true) === 1, 'flipping on twice changes nothing');
  const v = cm[1].getVertexPosition(5, new THREE.Vector3());
  skinnedUnder(clone)[0].skeleton.update();
  ok(cm[1].getVertexPosition(5, new THREE.Vector3()).distanceTo(v) < 1e-6, 'and draws where it did');
}

// ---------------------------------------------------------------------------------------------
// Commit 3b: once a frame.
{
  installSkeletonOnce();
  installSkeletonOnce();
  const { root, bones, skeleton } = makeBody(1);
  skeleton.computeBoneTexture();
  // After the texture is made: making it puts the matrices in a new, larger array.
  const matrices = skeleton.boneMatrices as Float32Array;
  const tex = skeleton.boneTexture as THREE.DataTexture;
  root.updateMatrixWorld(true);
  const u0 = SKELETON_FRAME.updated;
  const s0 = SKELETON_FRAME.skipped;
  skeleton.update();
  const v0 = tex.version;
  bones[2].position.y += 0.3;
  root.updateMatrixWorld(true);
  skeleton.update();
  ok(SKELETON_FRAME.updated - u0 === 2 && tex.version === v0 + 1, 'outside a frame every call recomputes and sets the bone texture for upload, as three does');
  const before = matrices[2 * 16 + 13];
  beginSkeletonFrame();
  skeleton.update();
  const first = matrices[2 * 16 + 13];
  const v1 = tex.version;
  // The bone moves between two passes of one frame (which nothing in the game may do) and is not seen: the proof that nothing is recomputed.
  bones[2].position.y += 0.5;
  root.updateMatrixWorld(true);
  skeleton.update();
  skeleton.update();
  ok(first === before && matrices[2 * 16 + 13] === first && tex.version === v1, 'inside an open frame the second and third updates recompute nothing and upload nothing');
  ok(SKELETON_FRAME.skipped - s0 === 2, 'and are counted as skipped');
  endSkeletonFrame();
  skeleton.update();
  ok(matrices[2 * 16 + 13] !== first && tex.version === v1 + 1, 'once the frame is closed the next update recomputes');
  beginSkeletonFrame();
  skeleton.update();
  const f2 = matrices[2 * 16 + 13];
  bones[2].position.y += 0.5;
  root.updateMatrixWorld(true);
  skeleton.update();
  ok(matrices[2 * 16 + 13] === f2, 'and a new frame works it out once again');
  endSkeletonFrame();
  SKELETON_TUNE.once = false;
  beginSkeletonFrame();
  skeleton.update();
  const f3 = matrices[2 * 16 + 13];
  bones[2].position.y += 0.5;
  root.updateMatrixWorld(true);
  skeleton.update();
  ok(matrices[2 * 16 + 13] !== f3, 'with the switch off every update in a frame recomputes, as before');
  endSkeletonFrame();
  SKELETON_TUNE.once = true;

  // The frame report counts through the one patch: a real update and a skip, in the same frame.
  PERF.on = true;
  perf.installSkeletonHook();
  let t = 10;
  perf.frameStart(t);
  beginSkeletonFrame();
  skeleton.update();
  skeleton.update();
  skeleton.update();
  endSkeletonFrame();
  ok(PERF.c[CNT.skelUpdated] === 1 && PERF.c[CNT.skelSkipped] === 2 && PERF.c[CNT.skelLive] === 1, 'the frame report counts one update, two skipped and one skeleton live');
  t += 16;
  perf.frameEnd(t, 0);
  PERF.on = false;
}

// ---------------------------------------------------------------------------------------------
// Commit 3c: a fixed sphere on every skinned mesh.
{
  // The manager's own frames: the group at the feet plus the body's feet, turned by its heading; the inner
  // group back down to the feet and scaled with the body; the model under it.
  const scale = 1.7;
  const feet = 0.6;
  const cullY = 1.05 * scale;
  const cullR = 1.2 * scale;
  const { root } = makeBody(3);
  const body = cloneShared(root, true);
  const group = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.y = -feet;
  inner.scale.setScalar(scale);
  inner.rotation.y = 0.35;
  group.add(inner);
  inner.add(body);
  // A rigid mesh, a weapon on the head bone, and a skinned mesh hung under a bone (which may not take a sphere).
  let headBone: THREE.Bone | null = null;
  body.traverse((o) => {
    if (o.name === 'head') headBone = o as THREE.Bone;
  });
  const rigid = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.8), new THREE.MeshBasicMaterial());
  (headBone as unknown as THREE.Bone).add(rigid);
  const stray = skinnedUnder(body)[0].clone();
  (headBone as unknown as THREE.Bone).add(stray);
  const list: THREE.Mesh[] = [];
  const listed = fitCullSpheres(body, inner, cullY / scale, cullR / scale, list, 1);
  const skinned = skinnedUnder(body).filter((m) => m !== stray);
  ok(listed === 4 && list.includes(rigid) && !list.includes(stray) && skinned.every((m) => list.includes(m)), 'the three skinned meshes and the rigid one are listed; a skinned mesh under a bone is not');
  ok(stray.boundingSphere === null || stray.boundingSphere.radius !== cullR, 'the one under a bone is given no sphere');
  ok(!(rigid as unknown as { boundingSphere?: unknown }).boundingSphere, "the rigid one keeps its geometry's own");
  const rel = new THREE.Matrix4();
  ok(frameOf(skinned[0], inner, rel) !== null && frameOf(stray, inner, rel) === null && frameOf(skinned[0], group.parent ?? new THREE.Group(), rel) === null, 'a frame is found only above the mesh and with no bone between');

  const frustum = new THREE.Frustum();
  const pv = new THREE.Matrix4();
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 900);
  const world = new THREE.Sphere();
  const grown = new THREE.Sphere();
  const next = rng(7);
  let agree = 0;
  let inView = 0;
  const sphereScale = 1.15;
  for (let k = 0; k < 200; k++) {
    // The body walks, turns and is seen from anywhere round it.
    const px = (next() - 0.5) * 60;
    const pz = (next() - 0.5) * 60;
    const py = (next() - 0.5) * 8;
    group.position.set(px, py + feet, pz);
    group.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), next() * Math.PI * 2);
    inner.rotation.y = (next() - 0.5) * 1.2;
    group.updateMatrixWorld(true);
    cam.position.set(px + (next() - 0.5) * 40, py + next() * 12, pz + (next() - 0.5) * 40);
    cam.lookAt(px + (next() - 0.5) * 30, py + (next() - 0.5) * 6, pz + (next() - 0.5) * 30);
    cam.updateMatrixWorld(true);
    pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pv);
    // The manager's own test: the body's sphere in the world.
    world.center.set(px, py + cullY, pz);
    world.radius = cullR;
    const group1 = frustum.intersectsSphere(world);
    if (group1) inView++;
    // Exactly the same sphere on every skinned mesh: the same answer, mesh by mesh.
    if (skinned.every((m) => frustum.intersectsObject(m) === group1)) agree++;
  }
  ok(agree === 200 && inView > 20 && inView < 190, `over 200 random cameras each mesh's own sphere and the manager's group sphere agree every time (${inView} in view)`);
  // Now the grown spheres, over the same cameras again.
  fitCullSpheres(body, inner, cullY / scale, cullR / scale, [], sphereScale);
  const next2 = rng(7);
  let within = 0;
  for (let k = 0; k < 200; k++) {
    const px = (next2() - 0.5) * 60;
    const pz = (next2() - 0.5) * 60;
    const py = (next2() - 0.5) * 8;
    group.position.set(px, py + feet, pz);
    group.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), next2() * Math.PI * 2);
    inner.rotation.y = (next2() - 0.5) * 1.2;
    group.updateMatrixWorld(true);
    cam.position.set(px + (next2() - 0.5) * 40, py + next2() * 12, pz + (next2() - 0.5) * 40);
    cam.lookAt(px + (next2() - 0.5) * 30, py + (next2() - 0.5) * 6, pz + (next2() - 0.5) * 30);
    cam.updateMatrixWorld(true);
    pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pv);
    world.center.set(px, py + cullY, pz);
    world.radius = cullR;
    if (!frustum.intersectsSphere(world) || skinned.every((m) => frustum.intersectsObject(m))) within++;
    const s = skinned[0].boundingSphere as THREE.Sphere;
    grown.copy(s).applyMatrix4(skinned[0].matrixWorld);
    if (Math.abs(grown.radius - cullR * sphereScale) > 1e-6 || grown.center.distanceTo(world.center) > 1e-6) within = -1000;
  }
  ok(within === 200, `with the sphere grown by ${sphereScale} every camera that sees the body's sphere sees every mesh, and each mesh's sphere lands on the body's, ${sphereScale} times its size`);

  // The switch and a ragdoll: frustumCulled is all the cull there is.
  setBodyCulled(list, true);
  ok(list.every((m) => m.frustumCulled), 'on, every listed mesh is culled by three');
  setBodyCulled(list, false);
  ok(list.every((m) => !m.frustumCulled), 'off (the switch, or a ragdoll), none is');
  // A body hidden whole stays hidden whatever its meshes say: three projects nothing under a hidden root.
  const scene = new THREE.Scene();
  scene.add(group);
  setBodyCulled(list, true);
  group.visible = false;
  let drawn = 0;
  scene.traverseVisible((o) => {
    if ((o as THREE.Mesh).isMesh) drawn++;
  });
  ok(drawn === 0, 'a body its routing or its manager hid is drawn by no mesh of it');
  group.visible = true;

  // A fighter's sphere: the body's box rule with its arm span its height.
  const f = fighterCull(1.8, 0.35, { y: 0, radius: 0 });
  ok(Math.abs(f.y - 0.9) < 1e-9 && Math.abs(f.radius - 0.62 * Math.hypot(1.8, 1.8, 0.7)) < 1e-9, `a 1.8 m fighter's sphere stands at 0.9 m with a radius of ${f.radius.toFixed(2)} m`);
  const lying = Math.hypot(1.8, 0.8);
  ok(f.radius * SKELETON_TUNE.sphereScale > lying - 0.15, `grown, it reaches within a hand of a body lying at full length (${(f.radius * SKELETON_TUNE.sphereScale).toFixed(2)} m against ${lying.toFixed(2)} m)`);
  ok(fighterCull(0.1, 0.35, { y: 0, radius: 0 }).y === 0.25, 'a height too small to be a body is taken as half a metre');
}

// ---------------------------------------------------------------------------------------------
// Off its feet, a body is drawn whole: the sphere is a standing body's.
{
  const pose = (o: Partial<BodyPose> = {}): BodyPose => ({ ragdoll: false, dead: false, down: false, idle: null, ...o });
  ok(cullsOneByOne(pose(), true) && !cullsOneByOne(pose(), false), 'on its feet it is culled mesh by mesh while the switch is on, and never with it off');
  ok(!cullsOneByOne(pose({ ragdoll: true }), true), 'a ragdoll is not');
  ok(!cullsOneByOne(pose({ dead: true }), true), 'nor a body dead in its held death clip, which is every death on a world a server holds, and every one waiting for its ragdoll');
  ok(!cullsOneByOne(pose({ down: true }), true), 'nor one knocked down, or a fighter prone');
  ok(!cullsOneByOne(pose({ idle: 'idle:npc_dead_02' }), true) && !cullsOneByOne(pose({ idle: 'idle:wookiee_lying_restrained' }), true), 'nor one standing in an idle that lays it at full length');
  ok(['idle:npc_sitting_chair', 'idle:npc_sitting_ground', 'idle:npc_meditate', 'idle:worried', 'idle'].every((idle) => cullsOneByOne(pose({ idle }), true)), 'while sitting, meditating and every mood on its feet keep the cull');
  ok(!LYING_IDLE.test('idle:npc_sitting_table') && LYING_IDLE.test('idle:npc_dead_01'), 'the lying idles are told from the sitting ones by name');
  // Why: a body flat on the ground against the manager's own sphere, from the made-up body above (1.8 m
  // tall, its sphere 0.62 of its box's diagonal about its middle, grown by the scale): lying from its feet,
  // its head is past the sphere, which is what dropped a corpse whole at the screen's edge.
  const tall = 1.8;
  const cullR = 0.62 * Math.hypot(0.4, tall, 0.3) * SKELETON_TUNE.sphereScale;
  const headFromMiddle = Math.hypot(tall, tall / 2 - 0.15);
  ok(headFromMiddle > cullR, `a ${tall} m body lying from its feet puts its head ${headFromMiddle.toFixed(2)} m from the middle, past the ${cullR.toFixed(2)} m sphere`);
}

// ---------------------------------------------------------------------------------------------
// A creature's shadow, and the cascades' light boxes, with three's own cascades in node.
{
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 9000);
  camera.position.set(0, 1.7, 0);
  camera.updateMatrixWorld(true);
  const reach = 80;
  const margin = 150;
  const make = (dir: THREE.Vector3): { csm: CSM; boxes: THREE.Frustum[] } => {
    const csm = new CSM({ camera, parent: scene, cascades: 3, maxFar: reach, mode: 'practical', shadowMapSize: 1024, lightDirection: dir.clone().normalize(), lightMargin: margin, lightNear: 1, lightFar: margin + reach });
    csm.update();
    const boxes: THREE.Frustum[] = [];
    refreshCascadeBoxes(csm.lights, boxes);
    return { csm, boxes };
  };
  const slack = LOD_TUNE.shadowSlack;
  const at = (x: number, y: number, z: number, r = 1.3): THREE.Sphere => new THREE.Sphere(new THREE.Vector3(x, y, z), r + slack);
  const input = (dist: number, size: 'small' | 'medium' | 'large' | 'huge', inCascades?: boolean): LodInput => ({ dist, onScreen: true, nearScreen: true, busy: false, sizeClass: size, shadows: true, playerDist: dist, animRange: 160, room: -1, inCascades });

  // The sun high and to one side, the owner's own 80 m of shadows.
  const high = make(new THREE.Vector3(0.3, -1, 0.2));
  ok(high.boxes.length === 3 && high.boxes.every((b) => b.planes.every((p) => Number.isFinite(p.constant))), 'three cascades, three light boxes, refreshed from where the cascades have just put them');
  const again: THREE.Frustum[] = [];
  refreshCascadeBoxes(high.csm.lights, again);
  const store = again;
  refreshCascadeBoxes(high.csm.lights, again);
  ok(again === store && again.length === 3 && again.every((b, i) => b === high.boxes[i]), 'refreshed again, the same list holds the same three frusta: nothing is made');
  // The case the old rule got wrong: a body near the right edge of a 16:9 view, 70 m down it -- inside the
  // last cascade -- and 96 m away in a straight line.
  const edge = at(65, 0.9, -70);
  const straight = edge.center.distanceTo(camera.position);
  const viewFrustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  ok(viewFrustum.containsPoint(edge.center) && straight > reach, `a body on screen at the side, 70 m down the view and ${straight.toFixed(0)} m off in a straight line`);
  ok(reachesCascades(high.boxes, edge), 'stands inside a cascade light box');
  const was = LOD_TUNE.shadowClamp;
  LOD_TUNE.shadowClamp = true;
  ok(lodTier(input(straight, 'medium', true)).castShadow, "and throws its shadow, where a straight-line cut at the cascades' 80 m took it away");
  const far = at(0, 0.9, -600);
  ok(!reachesCascades(high.boxes, far), 'a body 600 m down the view reaches no box');
  ok(!lodTier(input(600, 'huge', false)).castShadow && lodTier(input(600, 'huge', undefined)).castShadow, 'and even a huge one throws no shadow there, while with no boxes known its size class decides');
  ok(lodTier(input(40, 'small', true)).castShadow && !lodTier(input(50, 'small', true)).castShadow, "inside a box a size class keeps its own reach (a small one's 45 m)");

  // A low sun straight ahead: a body past the last cascade throws its shadow back toward the camera, into it.
  const low = make(new THREE.Vector3(0, -0.3, 1));
  const past = at(0, 0.9, -120);
  ok(reachesCascades(low.boxes, past), 'with the sun low ahead, a body 120 m down the view -- past the 80 m of cascades -- is inside the last box, which reaches toward the sun');
  ok(lodTier(input(120, 'large', reachesCascades(low.boxes, past))).castShadow, 'so a large one there keeps the shadow it throws back into view');
  ok(!reachesCascades(low.boxes, at(0, 0.9, -(reach + margin + 120))), 'and one well past the reach toward the sun reaches no box');
  LOD_TUNE.shadowClamp = false;
  ok(lodTier(input(600, 'huge', false)).castShadow, 'the switch off: the size class alone, as before');
  LOD_TUNE.shadowClamp = was;
  high.csm.remove();
  low.csm.remove();
}

// ---------------------------------------------------------------------------------------------
// The wiring, read as text: `mobile.ts`, `npcs.ts`, `manager.ts` and `world.ts` are browser modules that drag
// the whole world in, so no body can be stood here, and a sphere hung in the wrong frame, or a pose the cull
// was never told of, compiles just as well.
{
  const src = (p: string): string => readFileSync(new URL(`../../../src/${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const mobile = src('world/mobiles/mobile.ts');
  const npcs = src('world/npcs.ts');
  const manager = src('world/mobiles/manager.ts');
  const worldSrc = src('world/world.ts');
  const body = (text: string, signature: RegExp): string => {
    const m = signature.exec(text);
    assert.ok(m, `no ${signature} in the source`);
    let i = text.indexOf('{', m.index + m[0].length - 1);
    let depth = 0;
    const start = i;
    for (; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}' && --depth === 0) break;
    }
    return text.slice(start, i + 1);
  };
  // The frames the test above proved against the manager's sphere: the inner group, at the feet and scaled with the body.
  ok(/fitCullSpheres\(this\.model, this\.inner, cull\.y \/ this\.scale, cull\.radius \/ this\.scale, this\.cullMeshes\)/.test(mobile), "a creature's sphere is `plan.cull` hung in its inner group's frame, over the body's scale");
  ok(/fitCullSpheres\(rig\.root, this\.group, c\.y, c\.radius, this\.cullMeshes\)/.test(npcs) && /this\.group\.position\.copy\(this\.pos\);/.test(npcs), "a fighter's is hung in its group's frame, which stands at its feet");
  // Every pose a body can lie in tells the cull.
  const told = (text: string, sig: RegExp) => /this\.applyCull\(\);/.test(body(text, sig));
  ok(told(mobile, /private die\(\): void \{/) && told(mobile, /startRagdoll\(\): void \{/) && told(mobile, /private endRagdoll\(\): void \{/), 'a creature dying, falling to a ragdoll and let go of it asks the cull again');
  ok(told(mobile, /knock\(dir: THREE\.Vector3, power: number\): void \{/) && told(mobile, /private stoodUp\(\): void \{/), 'knocked down and up again');
  ok(told(mobile, /sit\(x: number, y: number, z: number, heading: number\): void \{/) && told(mobile, /rise\(x: number, z: number\): void \{/), 'sat and risen, whose idle may lay it down');
  ok(told(mobile, /respawn\(x: number, y: number, z: number\): void \{/), 'and stood again, a clip-played death having had no ragdoll to end');
  const attach = body(mobile, /attach\(model: MobileBody, pack: PackAsset \| null, extras\?: MobileExtras\): \{ ok: boolean; warning: string \| null \} \{/);
  ok(attach.lastIndexOf('this.applyCull();') > attach.indexOf('this.roles = rolesFor('), "and when it is hung, once its idle is known");
  const applied = body(mobile, /  applyCull\(\): void \{/);
  ok(/p\.dead = this\.dead;/.test(applied) && /p\.down = this\.downPhase !== null;/.test(applied) && /p\.idle = this\.roles\?\.idle \?\? null;/.test(applied) && /cullsOneByOne\(p\)/.test(applied), 'a creature reads its death, its knockdown and its idle');
  ok(told(npcs, /private die\(\): void \{/) && told(npcs, /private startRagdoll\(\): void \{/) && /if \(\(p === 'prone'\) !== wasProne\) this\.applyCull\(\);/.test(npcs), 'a fighter dying, falling and going prone or getting up asks it too');
  ok(/p\.down = this\.posture === 'prone';/.test(npcs), 'and reads its posture');
  // The shadow rule: the manager asks the world's boxes with the same slack as the screen, and the world refreshes them after the cascades move.
  ok(/sphere\.radius = radius \+ tune\.shadowSlack;\s*inCascades = reachesCascades\(boxes, sphere\);/.test(manager) && /i\.inCascades = inCascades;/.test(manager), "the manager asks whether a body's sphere, with the shadow slack, reaches a cascade's box");
  ok(/csm\.update\(\);\s*refreshCascadeBoxes\(csm\.lights, this\.cascadeBoxes\);/.test(worldSrc) && /shadowBoxes: \(\) => \(this\.csm \? this\.cascadeBoxes : null\),/.test(worldSrc), 'and the world hands it the boxes, refreshed right after the cascades move');
}

console.log(`\n${checks} checks passed`);
