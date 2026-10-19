// The morph ladder (`padMorphs` in src/core/skinnedLoad.ts), checked on real three skinned meshes in node: a count is
// padded to its rung (3 to 7, 19 to 33) and one past the top keeps its own; two meshes on one geometry pad it once and
// both have their influences extended; the targets keep their names at their own indices; and every CPU path that reads
// a morphed vertex reads the very same numbers padded as unpadded, and never a NaN (`getVertexPosition`, a skinned
// mesh's bounding sphere, a clone).
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { padMorphs, SKINNED_STATS } from '../../../src/core/skinnedLoad.ts';
import { morphRung, PERSON_KEYS_TUNE } from '../../../src/world/personKeys.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** A skinned strip of `n` vertices on two bones with `targets` morph targets, each moving the vertices its own way. */
function skinnedWith(targets: number, vertices = 6): { mesh: THREE.SkinnedMesh; geometry: THREE.BufferGeometry } {
  const g = new THREE.BufferGeometry();
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const wts: number[] = [];
  for (let i = 0; i < vertices; i++) {
    pos.push(i * 0.5, (i % 2) * 0.3, 0);
    nor.push(0, 0, 1);
    idx.push(0, 1, 0, 0);
    const w = i / (vertices - 1);
    wts.push(1 - w, w, 0, 0);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('skinIndex', new THREE.Float32BufferAttribute(idx, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wts, 4));
  const tris: number[] = [];
  for (let i = 0; i + 2 < vertices; i++) tris.push(i, i + 1, i + 2);
  g.setIndex(tris);
  const mp: THREE.BufferAttribute[] = [];
  const mn: THREE.BufferAttribute[] = [];
  for (let t = 0; t < targets; t++) {
    const d: number[] = [];
    for (let i = 0; i < vertices; i++) d.push(0.01 * (t + 1) * i, 0.02 * Math.sin(t + i), -0.005 * t);
    mp.push(new THREE.Float32BufferAttribute(d, 3));
    mn.push(new THREE.Float32BufferAttribute(new Array(vertices * 3).fill(0), 3));
  }
  if (targets) {
    g.morphAttributes.position = mp;
    g.morphAttributes.normal = mn;
    g.morphTargetsRelative = true;
  }
  const mesh = new THREE.SkinnedMesh(g, new THREE.MeshStandardMaterial());
  const root = new THREE.Bone();
  const tip = new THREE.Bone();
  tip.position.set(0, 1, 0);
  root.add(tip);
  mesh.add(root);
  mesh.bind(new THREE.Skeleton([root, tip]));
  // Names as the loader leaves them: one a target, never '0' to 'n'.
  mesh.morphTargetDictionary = {};
  for (let t = 0; t < targets; t++) mesh.morphTargetDictionary[`blend_${t}`] = t;
  mesh.morphTargetInfluences = [];
  for (let t = 0; t < targets; t++) mesh.morphTargetInfluences.push(0.1 + 0.07 * t);
  return { mesh, geometry: g };
}

const group = (...m: THREE.Object3D[]): THREE.Group => {
  const g = new THREE.Group();
  for (const o of m) g.add(o);
  return g;
};

// ---- 1. The rungs. ----
ok(PERSON_KEYS_TUNE.morphLadder.join(',') === '0,7,33', 'the ladder is 0, 7, 33');
ok(morphRung(0) === 0 && morphRung(3) === 7 && morphRung(7) === 7 && morphRung(8) === 33 && morphRung(19) === 33 && morphRung(33) === 33 && morphRung(40) === 40, 'a count goes to the first rung at or above it, one past the top keeps its own');
for (const [count, rung] of [[3, 7], [19, 33], [40, 40], [7, 7], [0, 0]] as const) {
  const { mesh, geometry } = skinnedWith(count);
  const padded = padMorphs(group(mesh));
  const n = geometry.morphAttributes.position?.length ?? 0;
  ok(n === rung && (geometry.morphAttributes.normal?.length ?? 0) === rung, `${count} targets come out ${rung}, position and normal alike`);
  ok(padded === (rung !== count ? 1 : 0), `and the geometry is counted as padded only when it was (${padded})`);
  ok((mesh.morphTargetInfluences?.length ?? 0) === rung, `its influences are as long as its targets (${mesh.morphTargetInfluences?.length ?? 0})`);
}
ok(SKINNED_STATS.pastTop >= 1, 'a count past the top is counted as such');

// ---- 2. Two meshes on one geometry: padded once, both extended, names kept. ----
{
  const a = skinnedWith(4);
  const b = new THREE.SkinnedMesh(a.geometry, a.mesh.material);
  b.bind(a.mesh.skeleton);
  b.morphTargetDictionary = { ...a.mesh.morphTargetDictionary };
  b.morphTargetInfluences = a.mesh.morphTargetInfluences!.slice();
  const before = SKINNED_STATS.padded;
  const padded = padMorphs(group(a.mesh, b));
  ok(padded === 1 && SKINNED_STATS.padded === before + 1, 'two meshes on one geometry pad it once');
  ok(a.geometry.morphAttributes.position.length === 7, 'to its rung, not twice over');
  ok(a.mesh.morphTargetInfluences!.length === 7 && b.morphTargetInfluences!.length === 7, 'and both meshes have their influences extended');
  ok(a.mesh.morphTargetInfluences!.slice(4).every((v) => v === 0) && b.morphTargetInfluences!.slice(4).every((v) => v === 0), 'with the padding at nought');
  const names = Object.entries(a.mesh.morphTargetDictionary!);
  ok(names.length === 4 && names.every(([k, v]) => k === `blend_${v}`), 'every target keeps its own name at its own index, and no name is added');
  const zeros = a.geometry.morphAttributes.position.slice(4).map((t) => (t as THREE.BufferAttribute).array);
  ok(zeros.every((z) => z === zeros[0]) && (zeros[0] as Float32Array).every((v) => v === 0), 'the padded targets share one zero array');
  ok(padMorphs(group(a.mesh, b)) === 0, 'a second pass pads nothing (idempotent)');
}

// ---- 3. Every CPU path reads the same vertex, padded or not, and never a NaN. ----
{
  const plain = skinnedWith(19);
  const padded = skinnedWith(19);
  padMorphs(group(padded.mesh));
  ok(padded.geometry.morphAttributes.position.length === 33, 'the head-sized body comes out at 33');
  // Pose both skeletons alike, off their rest.
  for (const m of [plain.mesh, padded.mesh]) {
    m.skeleton.bones[1].rotation.z = 0.4;
    m.skeleton.bones[1].position.x = 0.2;
    m.updateMatrixWorld(true);
  }
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  let same = true;
  let finite = true;
  for (let i = 0; i < plain.geometry.getAttribute('position').count; i++) {
    plain.mesh.getVertexPosition(i, va);
    padded.mesh.getVertexPosition(i, vb);
    if (!Object.is(va.x, vb.x) || !Object.is(va.y, vb.y) || !Object.is(va.z, vb.z)) same = false;
    if (!Number.isFinite(vb.x) || !Number.isFinite(vb.y) || !Number.isFinite(vb.z)) finite = false;
  }
  ok(same, 'getVertexPosition reads every vertex bit for bit the same padded as unpadded');
  ok(finite, 'and never a NaN');
  plain.mesh.computeBoundingSphere();
  padded.mesh.computeBoundingSphere();
  const sa = plain.mesh.boundingSphere!;
  const sb = padded.mesh.boundingSphere!;
  ok(Number.isFinite(sb.radius) && Number.isFinite(sb.center.x) && Number.isFinite(sb.center.y) && Number.isFinite(sb.center.z), "a skinned mesh's bounding sphere comes out finite");
  ok(Object.is(sa.radius, sb.radius) && sa.center.equals(sb.center), 'and the same as unpadded');
  padded.mesh.computeBoundingBox();
  ok(padded.mesh.boundingBox!.min.toArray().every(Number.isFinite) && padded.mesh.boundingBox!.max.toArray().every(Number.isFinite), 'its box too');
  const copy = padded.mesh.clone();
  ok(copy.morphTargetInfluences!.length === 33 && copy.morphTargetInfluences!.slice(19).every((v) => v === 0), 'a clone keeps the extended influences');
  ok(Object.keys(copy.morphTargetDictionary!).length === 19 && copy.morphTargetDictionary!.blend_18 === 18, 'and the names');
  const ray = new THREE.Raycaster(new THREE.Vector3(1, 0.1, 5), new THREE.Vector3(0, 0, -1));
  const hits: THREE.Intersection[] = [];
  padded.mesh.raycast(ray, hits);
  ok(hits.every((h) => Number.isFinite(h.distance)), 'a ray against it reads no NaN');
}

console.log(`\n${checks} checks passed`);
