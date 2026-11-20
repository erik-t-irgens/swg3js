// The bone pool on WebGPU (the GPU port's pass 1, wave 4, item 2: `src/core/gpu/bonePool.ts`, `patchBones.ts`).
//
//  1. The maths: a body far from the world's middle, posed, its slot written; each matrix is the root's inverse times the
//     bone's world matrix times its inverse bind matrix worked in doubles (three's own products, to the float), and the
//     vertices skinned through the slot and the relative unbind land where three's own CPU skinning puts them, closer than
//     three's world-space floats do (the anchor-relative rule).
//  2. The slots: a body met by a draw is slotted and written there and then (previous equal to current); the frame writes
//     every body a draw met last frame in one write, last frame's bones copied to the previous half; a still body is written
//     once more, then skipped; a body no draw meets for `keepFrames` lets its slot go and, met again, refreshes its render
//     objects once; a full pool evicts a body no draw met lately, and with none to evict the body reads the identity.
//  3. The patch over a stand-in renderer: the key three takes to its graph cache, worked out by the build's own
//     `RenderObject.getMaterialCacheKey` text with the skeleton read as "pooled" (one key for every bone count, apart from an
//     unpooled body's); the library hands a pooled build's materials a `setupPosition` of their own, which runs three's own
//     with the body read as unskinned and puts the flag back whatever happens; the observer is told a pooled graph is not
//     animated; three's refresh question touches the pool and answers a full refresh where a slot moved; the live switch makes
//     again every render object keyed the other way; the card is written only once three has made the buffer.
//  4. The ledger reads a pooled render object's bone count as -1 ("pooled").
//  5. Nothing allocated in a frame (the pool's frame over 300 bodies, the refresh question at every draw, the per-object
//     values), in twelve fresh processes (`--alloc`), the least of three clean windows of 20,000 (`testing.md`).
//
// Run: node --expose-gc tools/swg/tests/bonePool.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { hashString } from 'three/tsl';
import { NodeMaterial } from 'three/webgpu';
import { BONES, BONE_IO, BONE_POOL_TUNE, BONE_STATS, RESERVED, boneFrame, boneFrameNo, isPooledRO, markPooledRO, mirror, pooledFor, pooledRecord, recFor, resetBonePoolForTests, rootOf, slotBase, slotPrev, slotSize, touch, unbindInto, writeSlot } from '../../../src/core/gpu/bonePool.ts';
import { GPU_KEYS } from '../../../src/core/gpu/gpuKeys.ts';
import { keyFieldsOf } from '../../../src/core/gpu/pipeLedger.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
let checks = 0;
const ok = (cond: unknown, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
};

/** A small deterministic random. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * A body as the game's are: bound where it was loaded (its model's own space, about the world's middle: the loader binds a
 * skinned mesh to its skeleton there, and a clone keeps that bind), then stood far out in the world and posed. An armature, a
 * chain of bones, a skinned mesh bound to them.
 */
function body(nBones: number, at: [number, number, number], seed: number, verts = 40): { root: THREE.Group; arm: THREE.Group; mesh: THREE.SkinnedMesh; bones: THREE.Bone[]; pose: (k: number) => void } {
  const r = rng(seed);
  const root = new THREE.Group();
  const yaw = 0.7 + r();
  const arm = new THREE.Group();
  arm.position.set(0.1, 0.02, -0.2);
  arm.rotation.x = -Math.PI / 2 + 0.1;
  root.add(arm);
  const bones: THREE.Bone[] = [];
  for (let i = 0; i < nBones; i++) {
    const b = new THREE.Bone();
    b.position.set((r() - 0.5) * 0.3, 0.05 + r() * 0.2, (r() - 0.5) * 0.3);
    b.quaternion.setFromEuler(new THREE.Euler((r() - 0.5) * 0.6, (r() - 0.5) * 0.6, (r() - 0.5) * 0.6));
    (i === 0 ? arm : bones[Math.floor(r() * i)]).add(b);
    bones.push(b);
  }
  const pos = new Float32Array(verts * 3);
  const nor = new Float32Array(verts * 3);
  const idx = new Float32Array(verts * 4);
  const wt = new Float32Array(verts * 4);
  for (let v = 0; v < verts; v++) {
    pos.set([(r() - 0.5) * 0.8, r() * 1.8, (r() - 0.5) * 0.5], v * 3);
    const n = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
    nor.set([n.x, n.y, n.z], v * 3);
    const w = [r(), r(), r(), r()];
    const s = w[0] + w[1] + w[2] + w[3];
    for (let k = 0; k < 4; k++) {
      idx[v * 4 + k] = Math.floor(r() * nBones);
      wt[v * 4 + k] = w[k] / s;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(wt, 4));
  const mesh = new THREE.SkinnedMesh(g, new THREE.MeshStandardMaterial());
  mesh.position.set(0.02, -0.01, 0.03);
  arm.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  // Stood in the world after its load.
  root.position.set(at[0], at[1], at[2]);
  root.rotation.set(0.05, yaw, -0.03);
  root.updateMatrixWorld(true);
  const rest = bones.map((b) => b.quaternion.clone());
  const pose = (k: number): void => {
    const p = rng(seed * 31 + k);
    bones.forEach((b, i) => b.quaternion.copy(rest[i]).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler((p() - 0.5) * 0.8, (p() - 0.5) * 0.8, (p() - 0.5) * 0.8))));
    root.updateMatrixWorld(true);
  };
  pose(1);
  return { root, arm, mesh, bones, pose };
}

/**
 * A skinned vertex as the card works it (three's own program and the pool's alike): the place as (x, y, z, 1) through the bind
 * matrix, the four bones' matrices blended by the weights as they are stored (floats, their sum one to a float's precision),
 * then the unbind, all homogeneous (no division), the result's x, y and z. `bones(j)` is the matrix the program reads for
 * bone j, `bind` and `unbind` its per-object pair, `round` whether each product is rounded to a float as the card's are.
 */
function skinnedVertex(mesh: THREE.SkinnedMesh, i: number, bones: (j: number) => THREE.Matrix4, bind: THREE.Matrix4, unbind: THREE.Matrix4, round: boolean): THREE.Vector3 {
  const g = mesh.geometry;
  const fr = round ? Math.fround : (x: number): number => x;
  const v = new THREE.Vector4().fromBufferAttribute(g.attributes.position as THREE.BufferAttribute, i);
  v.w = 1;
  const at = (m: THREE.Matrix4, x: THREE.Vector4): THREE.Vector4 => {
    const e = m.elements;
    return new THREE.Vector4(fr(e[0] * x.x + e[4] * x.y + e[8] * x.z + e[12] * x.w), fr(e[1] * x.x + e[5] * x.y + e[9] * x.z + e[13] * x.w), fr(e[2] * x.x + e[6] * x.y + e[10] * x.z + e[14] * x.w), fr(e[3] * x.x + e[7] * x.y + e[11] * x.z + e[15] * x.w));
  };
  const b = at(bind, v);
  const acc = new THREE.Vector4(0, 0, 0, 0);
  for (let k = 0; k < 4; k++) {
    const j = (g.attributes.skinIndex as THREE.BufferAttribute).getComponent(i, k);
    const w = (g.attributes.skinWeight as THREE.BufferAttribute).getComponent(i, k);
    const s = at(bones(j), b);
    acc.set(fr(acc.x + fr(s.x * w)), fr(acc.y + fr(s.y * w)), fr(acc.z + fr(s.z * w)), fr(acc.w + fr(s.w * w)));
  }
  const o = at(unbind, acc);
  return new THREE.Vector3(o.x, o.y, o.z);
}

/** The vertex exactly (doubles throughout): three's world-space bones, the bind matrix and its inverse as three keeps them. */
function exactSkinned(mesh: THREE.SkinnedMesh, i: number): THREE.Vector3 {
  const sk = mesh.skeleton;
  return skinnedVertex(mesh, i, (j) => new THREE.Matrix4().multiplyMatrices(sk.bones[j].matrixWorld, sk.boneInverses[j]), mesh.bindMatrix, mesh.bindMatrixInverse, false);
}

/** Through the pool: the slot's matrices as stored (floats), the bind matrix and the relative unbind as floats, worked in floats. */
function poolSkinned(mesh: THREE.SkinnedMesh, i: number): THREE.Vector3 {
  const base = slotBase(mesh);
  const f = (m: THREE.Matrix4): THREE.Matrix4 => new THREE.Matrix4().fromArray(Float32Array.from(m.elements));
  return skinnedVertex(mesh, i, (j) => new THREE.Matrix4().fromArray(mirror, (base + j) * 16), f(mesh.bindMatrix), f(unbindInto(mesh, new THREE.Matrix4())), true);
}

/** Three's own program's arithmetic in floats: world-space bone matrices, the bind matrix and its inverse as floats. */
function threeFloatSkinned(mesh: THREE.SkinnedMesh, i: number): THREE.Vector3 {
  const f = (m: THREE.Matrix4): THREE.Matrix4 => new THREE.Matrix4().fromArray(Float32Array.from(m.elements));
  const sk = mesh.skeleton;
  return skinnedVertex(mesh, i, (j) => f(new THREE.Matrix4().multiplyMatrices(sk.bones[j].matrixWorld, sk.boneInverses[j])), f(mesh.bindMatrix), f(mesh.bindMatrixInverse), true);
}

// ---------------------------------------------------------------- 5 (child). what a frame allocates, in a process of its own
if (process.argv.includes('--alloc')) {
  const v8 = await import('node:v8');
  const { PerformanceObserver } = await import('node:perf_hooks');
  const gc = (globalThis as Any).gc as (o?: unknown) => void;
  let collections = 0;
  new PerformanceObserver((l) => (collections += l.getEntries().length)).observe({ entryTypes: ['gc'] });
  const young = (): number => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')!.space_used_size;
  const turn = () => new Promise((r) => setImmediate(r));
  const least = async (step: () => void, n: number): Promise<number> => {
    let best = Number.POSITIVE_INFINITY;
    for (let w = 0; w < 3; w++) {
      for (let tries = 0; tries < 6; tries++) {
        for (let i = 0; i < 2000; i++) step();
        gc({ type: 'minor' });
        await turn();
        await turn();
        const c0 = collections;
        const b = young();
        for (let i = 0; i < n; i++) step();
        const a = young();
        await turn();
        await turn();
        if (collections === c0) {
          best = Math.min(best, (a - b) / n);
          break;
        }
      }
    }
    return best;
  };
  resetBonePoolForTests();
  BONES.applied = true;
  const writes = { n: 0 };
  BONE_IO.write = (at: number, count: number): void => {
    writes.n += count > at ? 1 : 1;
  };
  // A crowd: 300 bodies of 53 bones, each with a render object a pass draws; half of them move a bone every frame.
  const bodies: { mesh: THREE.SkinnedMesh; ro: object; bone: THREE.Bone }[] = [];
  for (let i = 0; i < 300; i++) {
    const b = body(53, [3000 + i, 5, -4000 - i], 900 + i, 4);
    const ro = { object: b.mesh };
    markPooledRO(ro);
    bodies.push({ mesh: b.mesh, ro, bone: b.bones[3] });
  }
  let f = 0;
  const frame = (): void => {
    f ^= 1;
    for (let i = 0; i < bodies.length; i += 2) bodies[i].bone.matrixWorld.elements[12] += f === 1 ? 0.001 : -0.001;
    boneFrame();
    for (let i = 0; i < bodies.length; i++) touch(pooledRecord(bodies[i].ro)!, bodies[i].mesh.skeleton);
  };
  for (let i = 0; i < 4; i++) frame();
  const out: Record<string, number> = {};
  // A whole frame of 300 bodies is long: a window of 2,000 frames (the heap reading's own 2.3 KB is 1.2 B a frame there).
  out.frame = (await least(frame, 2000)) / 300;
  // The patch's refresh question at every draw, and the per-object values three asks for at a full refresh.
  const { installBonePatch } = await import('../../../src/core/gpu/patchBones.ts');
  const r = fakeRenderer();
  installBonePatch(r);
  let k = 0;
  out.refresh = await least(() => {
    r._nodes.needsRefresh(bodies[k].ro);
    k = k + 1 === bodies.length ? 0 : k + 1;
  }, 20000);
  const m4 = new THREE.Matrix4();
  out.values = await least(() => {
    const m = bodies[k].mesh;
    slotBase(m);
    slotPrev(m);
    unbindInto(m, m4);
    k = k + 1 === bodies.length ? 0 : k + 1;
  }, 20000);
  console.log(JSON.stringify(out));
  process.exit(0);
}

/** A stand-in for the parts of three's WebGPU renderer the patch reaches. */
function fakeRenderer(): Any {
  const buffers = new Map<object, { buffer?: object }>();
  const queue = { calls: [] as [number, number, number][], writeBuffer(_b: object, byte: number, _d: Float32Array, at: number, count: number) {
    if (this.calls.length < 64) this.calls.push([byte, at, count]);
  } };
  const set = new Set<Any>();
  return {
    _nodes: {
      getForRenderCacheKey: (ro: Any) => ro.initialCacheKey,
      _createNodeBuilderState: (nb: Any) => ({ observer: { hasAnimation: nb.object?.isSkinnedMesh === true } }),
      needsRefresh: (_ro: Any) => 0,
    },
    library: { fromMaterial: (m: Any) => (m.isNodeMaterial ? m : new NodeMaterial()) },
    backend: { get: (o: object) => (buffers.get(o) ?? (buffers.set(o, {}), buffers.get(o)!)), device: { queue } },
    _objects: { _renderObjects: set },
    buffers,
    queue,
  };
}

// ---------------------------------------------------------------- 1. the maths
{
  resetBonePoolForTests();
  BONES.applied = true;
  const b = body(53, [4123.5, 37.2, -2876.1], 7);
  const sk = b.mesh.skeleton;
  ok(rootOf(sk) === b.arm, "body space is measured from the parent of the skeleton's top bone (the armature)");
  const ro = { object: b.mesh };
  markPooledRO(ro);
  ok(touch(pooledRecord(ro)!, sk) === true, "a body's first draw slots it and asks a full refresh (its per-object values written)");
  const r = recFor(sk);
  ok(r.base >= RESERVED && r.size === 64 && r.n === 53, `its slot is past the identity block, 53 bones rounded up to 64 a half (base ${r.base})`);
  // Each matrix three's own products would make, in doubles, to the float.
  const rinv = new THREE.Matrix4().copy(b.arm.matrixWorld).invert();
  let exact = 0;
  let worstBody = 0;
  for (let j = 0; j < 53; j++) {
    const want = new THREE.Matrix4().multiplyMatrices(rinv, sk.bones[j].matrixWorld).multiply(sk.boneInverses[j]);
    for (let e = 0; e < 16; e++) {
      if (mirror[(r.base + j) * 16 + e] === Math.fround(want.elements[e])) exact++;
      if (e === 12 || e === 13 || e === 14) worstBody = Math.max(worstBody, Math.abs(want.elements[e]));
    }
  }
  ok(exact === 53 * 16, `every matrix is the root's inverse times the bone's world matrix times its inverse bind matrix, worked in doubles as three's own products work them, to the float (${exact} of ${53 * 16})`);
  ok(worstBody < 10, `and body space keeps every translation small (largest ${worstBody.toFixed(2)} m, the root ${b.root.position.length().toFixed(0)} m from the middle)`);
  // Previous equal to current on a first write.
  let same = true;
  for (let e = 0; e < 53 * 16; e++) if (mirror[(r.base + r.size) * 16 + e] !== mirror[r.base * 16 + e]) same = false;
  ok(same, 'a slot new to the pool gets previous equal to current (nothing smears on its first frame)');
  // The vertices: three's own CPU skinning (doubles) against the pool's slot and against three's own floats.
  let poolErr = 0;
  let threeErr = 0;
  for (let i = 0; i < 40; i++) {
    const want = exactSkinned(b.mesh, i);
    poolErr = Math.max(poolErr, poolSkinned(b.mesh, i).distanceTo(want));
    threeErr = Math.max(threeErr, threeFloatSkinned(b.mesh, i).distanceTo(want));
  }
  ok(poolErr < 2e-6, `every vertex skinned through the slot and the relative unbind lands where three's CPU skinning puts it (worst ${(poolErr * 1e6).toFixed(3)} µm)`);
  ok(threeErr > poolErr * 4, `closer than three's own world-space floats put it, 4,000 m from the middle (three's worst ${(threeErr * 1e6).toFixed(1)} µm against the pool's ${(poolErr * 1e6).toFixed(3)} µm)`);
  const u = unbindInto(b.mesh, new THREE.Matrix4());
  const w = new THREE.Matrix4().multiplyMatrices(b.mesh.bindMatrixInverse, b.arm.matrixWorld);
  ok(u.equals(w), "the per-object unbind is three's bindMatrixInverse times the root's world matrix, in doubles");
  // A detached bind (a skeleton shared by a mesh elsewhere): three's unbind is its bind matrix's inverse; the same rule holds.
  const d = body(30, [-3500, 12, 2200], 11);
  d.mesh.bindMode = THREE.DetachedBindMode;
  d.mesh.updateMatrixWorld(true);
  const dro = { object: d.mesh };
  markPooledRO(dro);
  touch(pooledRecord(dro)!, d.mesh.skeleton);
  let dErr = 0;
  let dThree = 0;
  for (let i = 0; i < 40; i++) {
    dErr = Math.max(dErr, poolSkinned(d.mesh, i).distanceTo(exactSkinned(d.mesh, i)));
    dThree = Math.max(dThree, threeFloatSkinned(d.mesh, i).distanceTo(exactSkinned(d.mesh, i)));
  }
  ok(dErr <= dThree * 1.5 + 1e-6, `a detached bind (its unbind carrying the root's place) skins through the pool no worse than three's own floats (worst ${(dErr * 1e6).toFixed(1)} µm against three's ${(dThree * 1e6).toFixed(1)} µm)`);
  // A wearable bound to the same skeleton at another place under the body reads the same slot and its own unbind.
  const wear = new THREE.SkinnedMesh(b.mesh.geometry, new THREE.MeshStandardMaterial());
  wear.position.set(0.3, 0.1, -0.05);
  b.root.add(wear);
  b.root.updateMatrixWorld(true);
  wear.bind(sk, b.mesh.bindMatrix.clone());
  b.root.updateMatrixWorld(true);
  let wErr = 0;
  for (let i = 0; i < 40; i++) wErr = Math.max(wErr, poolSkinned(wear, i).distanceTo(exactSkinned(wear, i)));
  ok(slotBase(wear) === r.base && wErr < 2e-6, `a second mesh on one skeleton (a worn piece, bound elsewhere) reads the skeleton's slot with an unbind of its own (worst ${(wErr * 1e6).toFixed(3)} µm)`);
  ok(slotSize(1) === 16 && slotSize(16) === 16 && slotSize(17) === 32 && slotSize(53) === 64 && slotSize(62) === 64, 'a slot half is the bones rounded up to sixteen');
}

// ---------------------------------------------------------------- 2. the slots, frame by frame
{
  resetBonePoolForTests();
  BONES.applied = true;
  const sent: [number, number][] = [];
  BONE_IO.write = (at, count) => sent.push([at, count]);
  const a = body(53, [100, 0, 100], 21);
  const b = body(38, [120, 0, 90], 22);
  const ra = { object: a.mesh };
  const rb = { object: b.mesh };
  markPooledRO(ra);
  markPooledRO(rb);
  const pa = pooledRecord(ra)!;
  const pb = pooledRecord(rb)!;
  ok(isPooledRO(ra) && !isPooledRO({}), 'a render object keyed as pooled is known as one, another is not');
  // Frame 1: both drawn for the first time (written late, each its own write).
  boneFrame();
  touch(pa, a.mesh.skeleton);
  touch(pb, b.mesh.skeleton);
  ok(sent.length === 2 && BONE_STATS.late === 2, `a body drawn the first time is written by that draw, one write of its own slot each (${sent.length} writes)`);
  const A = recFor(a.mesh.skeleton);
  const Bk = recFor(b.mesh.skeleton);
  ok(sent[0][0] === A.base * 16 && sent[0][1] === (A.size + A.n) * 16, "a late write covers the slot's current half and its previous bones");
  // Frame 2: both were drawn last frame: written by the frame, in one write; previous is last frame's current.
  const curBefore = mirror.slice(A.base * 16, (A.base + A.n) * 16);
  a.pose(2);
  sent.length = 0;
  boneFrame();
  ok(sent.length === 1 && BONE_STATS.written === 1 && BONE_STATS.still === 1, `the frame looks at every body a draw met last frame and writes the one that moved in one write; the other, still since its first write (its halves equal already), is skipped (${sent.length} write, ${BONE_STATS.written} written, ${BONE_STATS.still} still)`);
  ok(sent[0][0] <= A.base * 16 && sent[0][0] + sent[0][1] >= (A.base + A.size + A.n) * 16, 'and the one write spans every slot written');
  let prevIsOld = true;
  for (let e = 0; e < A.n * 16; e++) if (mirror[(A.base + A.size) * 16 + e] !== curBefore[e]) prevIsOld = false;
  ok(prevIsOld, "a body in motion carries last frame's bones in its previous half");
  let moved = false;
  for (let e = 0; e < A.n * 16; e++) if (mirror[A.base * 16 + e] !== curBefore[e]) moved = true;
  ok(moved, "and this frame's in its current half");
  touch(pa, a.mesh.skeleton);
  touch(pb, b.mesh.skeleton);
  ok(BONE_STATS.late === 0, 'a body the frame wrote is not written again by its draws');
  // Frame 3: nothing moved: each is written once more (previous then equal to current) ...
  sent.length = 0;
  boneFrame();
  touch(pa, a.mesh.skeleton);
  touch(pb, b.mesh.skeleton);
  ok(BONE_STATS.written === 1 && BONE_STATS.still === 1, `a body still since its last write is written once more (the one that moved last frame: ${BONE_STATS.written}), one whose halves agree already is skipped (${BONE_STATS.still})`);
  // Frame 4: ... and then skipped.
  sent.length = 0;
  boneFrame();
  ok(BONE_STATS.written === 0 && BONE_STATS.still === 2 && sent.length === 0, 'then every still body is skipped, and nothing is sent to the card');
  touch(pa, a.mesh.skeleton);
  // b not drawn in frame 4. Frame 5: a written as still, b not written (not drawn last frame).
  boneFrame();
  ok(BONE_STATS.still === 1 && BONE_STATS.written === 0, 'a body no draw met last frame is left out of the frame');
  // b drawn again in frame 5 after a frame out: written late, previous equal to current.
  b.pose(3);
  const late0 = BONE_STATS.lateAll;
  ok(touch(pb, b.mesh.skeleton) === false, 'met again within its keep, its slot unmoved: no full refresh');
  ok(BONE_STATS.lateAll === late0 + 1, 'and written by its draw, since the frame did not reach it');
  let eq = true;
  for (let e = 0; e < Bk.n * 16; e++) if (mirror[(Bk.base + Bk.size) * 16 + e] !== mirror[Bk.base * 16 + e]) eq = false;
  ok(eq, 'its previous half equal to its current (nothing smears on its reappearing)');
  // keepFrames undrawn: its slot is let go; met again it takes one and its render objects are refreshed once.
  const baseWas = Bk.base;
  for (let i = 0; i < BONE_POOL_TUNE.keepFrames + 2; i++) {
    boneFrame();
    touch(pa, a.mesh.skeleton);
  }
  ok(Bk.base === -1 && BONE_STATS.released === 1, `a body no draw met for ${BONE_POOL_TUNE.keepFrames} frames lets its slot go`);
  ok(slotBase(b.mesh) === 0 && slotPrev(b.mesh) === 0, 'a body with no slot reads the identity block');
  ok(touch(pb, b.mesh.skeleton) === true && Bk.base === baseWas, 'met again it takes a slot (the one it gave up, off its free list) and its render object is refreshed in full once');
  ok(touch(pb, b.mesh.skeleton) === false, 'once');
  // A second render object of the same body (another pass) is refreshed once too.
  const rb2 = { object: b.mesh };
  markPooledRO(rb2);
  ok(touch(pooledRecord(rb2)!, b.mesh.skeleton) === true && touch(pooledRecord(rb2)!, b.mesh.skeleton) === false, "each render object of a body (each pass's) is refreshed once for its skeleton's slot");
  // A body rebound to another skeleton: its record follows.
  const other = body(41, [0, 0, 0], 23);
  b.mesh.skeleton = other.mesh.skeleton;
  ok(touch(pb, b.mesh.skeleton) === true && pb.rec!.skeleton === other.mesh.skeleton, "a render object whose mesh was bound to another skeleton follows it (and is refreshed for the new slot)");
  // Wave 4's fixer: rebound to a skeleton of its own bones' count (the render object kept, its key unchanged, as
  // `reshareSkeletons` does to a body already hung), whose record's epochs count from their own start like the old one's:
  // the draw still asks the full refresh that writes its slot, so it never reads a slot another body takes later.
  const c = body(53, [60, 0, 60], 24);
  const twin = body(53, [60, 0, 60], 25);
  const rc = { object: c.mesh };
  markPooledRO(rc);
  const pc = pooledRecord(rc)!;
  boneFrame();
  ok(touch(pc, c.mesh.skeleton) === true, 'a fresh body: refreshed for its slot');
  for (let i = 0; i < 3; i++) {
    boneFrame();
    touch(pc, c.mesh.skeleton);
  }
  const oldEpoch = recFor(c.mesh.skeleton).epoch;
  c.mesh.skeleton = twin.mesh.skeleton;
  boneFrame();
  const asked = touch(pc, c.mesh.skeleton);
  ok(recFor(twin.mesh.skeleton).epoch === oldEpoch, `the new skeleton's record stands at the old one's epoch (${oldEpoch}), so the epoch alone cannot tell them apart`);
  ok(asked === true && slotBase(c.mesh) === recFor(twin.mesh.skeleton).base && slotBase(c.mesh) >= RESERVED, `rebound to a skeleton of the same bones' count, its draw asks the refresh that writes the new slot (asked ${asked}, slot ${slotBase(c.mesh)})`);
  ok(touch(pc, c.mesh.skeleton) === false, 'once');
}

// ---------------------------------------------------------------- 2b. a full pool
{
  resetBonePoolForTests(RESERVED + 128 * 2);
  BONES.applied = true;
  const bodies = [0, 1, 2].map((i) => body(53, [i * 10, 0, 0], 40 + i, 4));
  const ros = bodies.map((b) => {
    const ro = { object: b.mesh };
    markPooledRO(ro);
    return ro;
  });
  boneFrame();
  touch(pooledRecord(ros[0])!, bodies[0].mesh.skeleton);
  touch(pooledRecord(ros[1])!, bodies[1].mesh.skeleton);
  touch(pooledRecord(ros[2])!, bodies[2].mesh.skeleton);
  ok(BONE_STATS.overflow === 1 && slotBase(bodies[2].mesh) === 0, 'a pool full of bodies all drawn this frame leaves the next one at the identity (counted as overflow)');
  boneFrame();
  boneFrame();
  touch(pooledRecord(ros[1])!, bodies[1].mesh.skeleton);
  const was0 = recFor(bodies[0].mesh.skeleton).base;
  ok(touch(pooledRecord(ros[2])!, bodies[2].mesh.skeleton) === true && BONE_STATS.evicted === 1 && slotBase(bodies[2].mesh) === was0 && recFor(bodies[0].mesh.skeleton).base === -1, 'a full pool takes the slot of a body no draw met lately');
}

// ---------------------------------------------------------------- 3. the patch, over a stand-in renderer
{
  resetBonePoolForTests();
  // Three's own key, out of the build the game loads (as bodyStandIns.test.ts runs it).
  const req = createRequire(import.meta.url);
  const build = readFileSync(join(dirname(req.resolve('three')), '..', 'build', 'three.webgpu.js'), 'utf8');
  const cut = (start: string, indent: string): string => {
    const at = build.indexOf(start);
    assert.ok(at >= 0, `the build holds ${start.trim()}`);
    return build.slice(at, build.indexOf(`\n${indent}}\n`, at) + indent.length + 2);
  };
  const line = (s: string): string => build.slice(build.indexOf(s), build.indexOf('\n', build.indexOf(s)));
  const helpers = [line('const _protoKeysCache = '), line('const _enumProperties = '), cut('function getKeys( obj ) {', ''), cut('function getInstanceDataKey( attribute ) {', '')].join('\n');
  const body3 = (name: string): string => {
    const t = cut(`\t${name}() {`, '\t');
    return t.slice(t.indexOf('{') + 1, t.lastIndexOf('}'));
  };
  const fns = new Function('hashString', `${helpers}\nreturn { geometry: function () {${body3('getGeometryCacheKey')}}, material: function () {${body3('getMaterialCacheKey')}}, all: function () {${body3('getCacheKey')}} };`)(hashString) as { geometry: () => string; material: () => number; all: () => number };
  ok(/cacheKey \+= object\.skeleton\.bones\.length \+ ',';/.test(body3('getMaterialCacheKey')), "three reads a skinned body's bone count into its key, and nothing else of its skeleton");
  const sharedMat = new THREE.MeshStandardMaterial();
  const ro = (o: Any, m: Any = sharedMat): Any => {
    const r: Any = { object: o, material: m, geometry: o.geometry, scene: null, renderer: { backend: { isWebGPUBackend: true }, currentSamples: 4 }, _nodes: { getCustomProgramCacheKey: (x: Any) => x.customProgramCacheKey() }, clippingContextCacheKey: 'clip', context: { buildKey: 'ctx' } };
    r.getGeometryCacheKey = fns.geometry;
    r.getMaterialCacheKey = fns.material;
    r.getDynamicCacheKey = () => 7;
    r.getCacheKey = fns.all;
    r.initialCacheKey = r.getCacheKey();
    return r;
  };
  const geo = body(53, [0, 0, 0], 61).mesh.geometry;
  const mk = (n: number): THREE.SkinnedMesh => {
    const b = body(n, [0, 0, 0], 60 + n);
    b.mesh.geometry = geo;
    b.mesh.material = sharedMat;
    return b.mesh;
  };
  const m53 = mk(53);
  const m50 = mk(50);
  const k53 = ro(m53).initialCacheKey;
  const k50 = ro(m50).initialCacheKey;
  ok(k53 !== k50, "unpooled, three keys two bodies of one layout and material apart by their bone counts");
  const r = fakeRenderer();
  const { installBonePatch, setBonePool } = await import('../../../src/core/gpu/patchBones.ts');
  const own = (NodeMaterial.prototype as Any).setupPosition;
  ok(typeof own === 'function', "three's NodeMaterial has its own setupPosition");
  installBonePatch(r);
  ok(BONES.applied && GPU_KEYS.boneStorage, 'installed, the pool is applied and on');
  const p53 = ro(m53);
  const p50 = ro(m50);
  const kp53 = r._nodes.getForRenderCacheKey(p53);
  const kp50 = r._nodes.getForRenderCacheKey(p50);
  ok(kp53 === kp50, "pooled, the key three takes to its graph cache is one for every bone count (three's own key, the skeleton read as \"pooled\")");
  ok(kp53 !== k53 && kp53 !== k50, "and apart from every unpooled body's key");
  ok(m53.skeleton.bones.length === 53 && (m53.skeleton as Any).bones !== undefined && m53.skeleton.boneInverses.length === 53, "and the body's own skeleton is put back as it was");
  ok(isPooledRO(p53) && isPooledRO(p50), 'each such render object is known as pooled');
  const rigid = new THREE.Mesh(geo, sharedMat);
  const pr = ro(rigid);
  ok(r._nodes.getForRenderCacheKey(pr) === pr.initialCacheKey && !isPooledRO(pr), "a rigid mesh is keyed by three's own key, untouched");
  const displaced = new THREE.MeshStandardMaterial({ displacementMap: new THREE.Texture() });
  const pd = ro(m53, displaced);
  ok(r._nodes.getForRenderCacheKey(pd) === pd.initialCacheKey && !isPooledRO(pd) && !pooledFor(m53, displaced), "a body in a material that moves its places before skinning would (a displacement map) is left to three's own skinning");
  // The library: a material built for a pooled body skins through the pool; one built for anything else is three's own.
  r._nodes.getForRenderCacheKey(p53);
  const nm = r.library.fromMaterial(sharedMat);
  ok(Object.prototype.hasOwnProperty.call(nm, 'setupPosition') && nm.setupPosition !== own, "a material built for a pooled body is given a setupPosition of its own");
  r._nodes.getForRenderCacheKey(pr);
  const nm2 = r.library.fromMaterial(sharedMat);
  ok(!Object.prototype.hasOwnProperty.call(nm2, 'setupPosition'), 'one built for anything else keeps three\'s own');
  // Its setupPosition, run for real over three's own (whose part for a body with no morphs builds nothing but hands back the
  // place): three's own reads the body as unskinned, the flag is put back whatever happens, and the builder is marked.
  ok(nm.setupPosition.name === 'pooledSetupPosition', "the own method is the pool's");
  const reads: boolean[] = [];
  const watch = (m: THREE.SkinnedMesh): void => {
    let v = true;
    Object.defineProperty(m, 'isSkinnedMesh', { configurable: true, get: () => (reads.push(v), v), set: (x: boolean) => (v = x) });
  };
  watch(m53);
  const pooledBuilder = { object: m53, geometry: m53.geometry };
  const out = nm.setupPosition(pooledBuilder);
  ok(out !== undefined && out !== null, "a pooled body's position comes back from three's own setup");
  ok(reads.includes(false) && m53.isSkinnedMesh === true, "three's own ran with the body read as unskinned (its own skinning left out), and the flag is back");
  ok(r._nodes._createNodeBuilderState(pooledBuilder).observer.hasAnimation === false, "the graph that skinned through the pool is told its object is not animated");
  const plainBuilder = { object: m50, geometry: m50.geometry };
  ok(r._nodes._createNodeBuilderState(plainBuilder).observer.hasAnimation === true, "one that did not keeps three's animated rule");
  let threw = false;
  try {
    nm.setupPosition({ object: m53, geometry: null });
  } catch {
    threw = true;
  }
  ok(threw && m53.isSkinnedMesh === true, "three's own throwing (a builder with no geometry) still puts the flag back");
  reads.length = 0;
  nm.setupPosition({ object: rigid, geometry: geo });
  ok(reads.length === 0, "a rigid mesh built with the same material is set up by three's own whole");
  // A displaced material: built for the same body, three's own skinning, the flag untouched.
  const nmd = (() => {
    r._nodes.getForRenderCacheKey(p53);
    const x = r.library.fromMaterial(new NodeMaterial());
    x.displacementMap = new THREE.Texture();
    return x;
  })();
  ok(!pooledFor(m53, nmd), "a material with a displacement map, though its own method is the pool's, leaves the body to three's skinning (its setup three's own whole, the branch the rigid mesh took)");
  delete (m53 as Any).isSkinnedMesh;
  (m53 as Any).isSkinnedMesh = true;
  ok(own === (NodeMaterial.prototype as Any).setupPosition, "three's own NodeMaterial.setupPosition is never replaced on the prototype");
  // The refresh question: a pooled body touched at every draw, a full refresh where its slot moved.
  // (A fresh pool and a fresh stand-in renderer, the patch installed on it.)
  resetBonePoolForTests();
  const r2 = fakeRenderer();
  installBonePatch(r2);
  const q = ro(m53);
  r2._nodes.getForRenderCacheKey(q);
  boneFrame();
  ok(r2._nodes.needsRefresh(q) === 2, "a pooled body's first draw: slotted, written, and refreshed in full (its slot a per-object value)");
  ok(r2._nodes.needsRefresh(q) === 0, "then three's own answer");
  ok(r2._nodes.needsRefresh(pr) === 0, 'a rigid mesh: three\'s own answer, the pool untouched');
  ok(boneFrameNo() === 1 && recFor(m53.skeleton).drawn === 1, 'the draw marks the skeleton drawn this frame');
  // The card is written only once three has made the buffer from the mirror.
  ok(r2.queue.calls.length === 0, 'before three has made the buffer, nothing is sent (it is made from the mirror as it stands)');
  for (const [, v] of r2.buffers) v.buffer = {};
  m53.skeleton.bones[2].matrixWorld.elements[12] += 0.01;
  boneFrame();
  ok(r2.buffers.size === 1 && r2.queue.calls.length === 1 && r2.queue.calls[0][0] === r2.queue.calls[0][1] * 4, `once it has, the frame's one write goes to three's own buffer for the pool's one attribute, its offset in bytes (${JSON.stringify(r2.queue.calls[0])})`);
  // The live switch: every render object keyed the other way let go of, made again at its next draw.
  const disposed: Any[] = [];
  const live = [q, pr, ro(m50)];
  for (const x of live) {
    x.dispose = () => disposed.push(x);
    r2._objects._renderObjects.add(x);
  }
  ok(setBonePool(false) === 1 && disposed.length === 1 && disposed[0] === q, `off: the pooled body's render object is let go of, the others kept (${disposed.length})`);
  ok(recFor(m53.skeleton).base === -1 && !pooledFor(m53, sharedMat), 'and every slot let go, no body pooled');
  disposed.length = 0;
  ok(setBonePool(true) === 1 && disposed.length === 1 && disposed[0] === live[2], 'on: the body keyed by its bone count is let go of, to be keyed "pooled"');
  ok(setBonePool(true) === 0, 'a switch moved to where it stands does nothing');
  GPU_KEYS.boneStorage = true;
}

// ---------------------------------------------------------------- 3b. the key kept for three's delete (wave 4's fixer)
{
  // Three's own graph cache, out of the build the game loads: `NodeManager.getForRender`, `delete` and
  // `getForRenderCacheKey` run as text over a stand-in data map, the patch installed on it. Three makes a render object again
  // when its key has moved (the scene's environment, `RenderObjects.get`), the old one let go through `delete`, which asks the
  // key again to take the graph out as its last user goes: it must be told the key the graph was filed under.
  resetBonePoolForTests();
  const req = createRequire(import.meta.url);
  const build = readFileSync(join(dirname(req.resolve('three')), '..', 'build', 'three.webgpu.js'), 'utf8').replace(/\r\n?/g, '\n');
  const method = (cls: string, name: string): string => {
    const at = build.search(new RegExp(`^class ${cls}\\b`, 'm'));
    const c = build.slice(at, build.indexOf('\n}\n', at) + 2);
    const m = c.search(new RegExp(`^\\t${name}\\(`, 'm'));
    return m < 0 ? '' : c.slice(m, c.indexOf('\n\t}\n', m) + 3);
  };
  const texts = ['getForRender', 'delete', 'getForRenderCacheKey'].map((n) => method('NodeManager', n));
  ok(texts.every((t) => t.length > 0) && texts[1].includes('this.nodeBuilderCache.delete( this.getForRenderCacheKey( object ) );'), "three's node manager's getForRender, delete and key, read out of the build");
  const data = new WeakMap<object, Any>();
  const base = {
    get(o: object): Any {
      let d = data.get(o);
      if (!d) data.set(o, (d = {}));
      return d;
    },
    delete(o: object): Any {
      const d = data.get(o);
      data.delete(o);
      return d;
    },
  };
  const N: Any = new Function('base', `const o = { ${texts.join(',\n')} }; Object.setPrototypeOf(o, base); return o;`)(base);
  N.nodeBuilderCache = new Map();
  let builds = 0;
  let ids = 0;
  N._createNodeBuilder = (r: Any) => ({ object: r.object, objectSpecific: false, build: () => void builds++ });
  N._createNodeBuilderState = () => ({ id: ++ids, usedTimes: 0, observer: { hasAnimation: true } });
  N.needsRefresh = () => 0;
  const set = new Set<Any>();
  const renderer = { _nodes: N, library: { fromMaterial: (m: Any) => m }, backend: { get: () => ({}), device: { queue: { writeBuffer() {} } } }, _objects: { _renderObjects: set } };
  const { installBonePatch, setBonePool } = await import('../../../src/core/gpu/patchBones.ts');
  installBonePatch(renderer);
  // Two people of one look and different bones; a render object keyed as three's are, its material's key (the bone count in
  // it) and the scene's environment as it stands, `initialCacheKey` taken as it is made; let go through three's delete.
  const env = { key: 100 };
  const look = new THREE.MeshStandardMaterial();
  const a = body(53, [0, 0, 0], 71).mesh;
  const b = body(50, [5, 0, 0], 72).mesh;
  a.material = look;
  b.material = look;
  const roOf = (mesh: THREE.SkinnedMesh): Any => {
    const r: Any = { isRenderObject: true, object: mesh, material: mesh.material, getCacheKey(): string { return `mat:${this.object.skeleton.bones.length}|env:${env.key}`; } };
    r.initialCacheKey = r.getCacheKey();
    r.dispose = (): void => {
      N.delete(r);
      set.delete(r);
    };
    set.add(r);
    return r;
  };
  const filed = (): string => [...N.nodeBuilderCache.entries()].map(([k, v]: [string, Any]) => `${k}#${v.id}x${v.usedTimes}`).join(' ');
  let ra = roOf(a);
  let rb = roOf(b);
  const s1 = N.getForRender(ra);
  ok(N.getForRender(rb) === s1 && builds === 1, `two bodies of one look and different bones share one graph (${filed()})`);
  // The environment moves: each render object let go (its graph through the delete) and made again.
  env.key = 200;
  ra.dispose();
  ra = roOf(a);
  const s2 = N.getForRender(ra);
  rb.dispose();
  rb = roOf(b);
  const s3 = N.getForRender(rb);
  ok(s2 === s3 && builds === 2, `made again under the new environment they share one graph again, built once (builds ${builds})`);
  ok(N.nodeBuilderCache.size === 1 && N.nodeBuilderCache.get(N.getForRenderCacheKey(ra)) === s2 && s2.usedTimes === 2, `the old graph left the cache as its last user went, the live one kept (${filed()})`);
  ok(N.getForRenderCacheKey(ra) === 'mat:pooled|env:200' && ra.initialCacheKey === 'mat:53|env:200', "a pooled render object's key is the one it was given at its build, apart from three's own");
  env.key = 300;
  ok(N.getForRenderCacheKey(ra) === 'mat:pooled|env:200', "and stays so when the environment moves on (as three's `initialCacheKey` does)");
  // The switch off: each pooled render object let go names its own graph though the pool is off by then.
  ok(setBonePool(false) === 2 && N.nodeBuilderCache.size === 0 && set.size === 0, `off: both let go, their graph taken out of the cache (${filed() || 'empty'})`);
  ra = roOf(a);
  rb = roOf(b);
  N.getForRender(ra);
  N.getForRender(rb);
  ok(N.nodeBuilderCache.size === 2 && N.getForRenderCacheKey(ra) === ra.initialCacheKey, `made again unpooled, each is keyed by three's own key (${filed()})`);
  // On again: each body keyed by three's own is let go under three's own key, never a pooled one.
  ok(setBonePool(true) === 2 && N.nodeBuilderCache.size === 0, `on: both let go under the keys they were filed under (${filed() || 'empty'})`);
  ra = roOf(a);
  N.getForRender(ra);
  ok(isPooledRO(ra) && N.nodeBuilderCache.size === 1, 'and made again, keyed "pooled"');
  GPU_KEYS.boneStorage = true;
}

// ---------------------------------------------------------------- 4. the ledger
{
  resetBonePoolForTests();
  BONES.applied = true;
  const b = body(53, [0, 0, 0], 91);
  const r: Any = { object: b.mesh, material: b.mesh.material, geometry: b.mesh.geometry, context: {}, getDynamicCacheKey: () => 1 };
  ok(keyFieldsOf(r).bones === 53, 'the ledger reads an unpooled body\'s bone count');
  markPooledRO(r);
  ok(keyFieldsOf(r).bones === -1, 'and a pooled body\'s as -1 ("pooled"), whatever its bones');
}

// ---------------------------------------------------------------- 5. nothing allocated in a frame, in twelve fresh processes at once
{
  const me = fileURLToPath(import.meta.url);
  const runs = await Promise.all(
    Array.from({ length: 12 }, () =>
      new Promise<Record<string, number> | string>((res) => {
        const ch = spawn(process.execPath, ['--expose-gc', me, '--alloc'], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        ch.stdout.on('data', (x) => (out += x));
        ch.stderr.on('data', (x) => (err += x));
        ch.on('close', () => {
          try {
            res(JSON.parse(out.trim().split('\n').pop() ?? ''));
          } catch {
            res(`no answer: ${err.slice(0, 300)}`);
          }
        });
      }),
    ),
  );
  const bad = runs.filter((r) => typeof r === 'string');
  ok(bad.length === 0, `every process answered (${bad.join('; ')})`);
  const got = runs as Record<string, number>[];
  for (const [k, what] of [['frame', 'the pool\'s frame (a body)'], ['refresh', "the refresh question at a draw"], ['values', 'the per-object values']] as const) {
    const v = got.map((r) => r[k]);
    const said = v.map((x) => (Number.isFinite(x) ? x.toFixed(3) : 'no clean window')).join(' ');
    ok(v.every((x) => Number.isFinite(x) && x < 0.5), `${what} allocates nothing in 12 of 12 processes (${said} B a call)`);
    console.log(`  ${what}: ${said} B a call`);
  }
}

console.log(`bonePool: ${checks} checks passed`);
