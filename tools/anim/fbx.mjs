// One Mixamo FBX read into the pack's own terms, with three's FBXLoader (which parses in node once `self` exists):
// the skeleton's rest pose and the clip resampled to the pack's rate as each bone's world rotation delta from its rest.
// The files are a skeleton and one take, 60 frames a second, centimetres, Y up, facing +Z.
import * as THREE from 'three';
import { PACK_FPS, continuousSign, frameTime } from '../../src/anim/mxaFile.ts';

globalThis.self ??= globalThis;
const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');

/** The source's names carry a prefix (`mixamorig`, `mixamorig1:`): taken off. */
export const stripPrefix = (n) => n.replace(/^mixamorig\d*[:_]?/i, '');

/** Centimetres to metres. */
const CM = 0.01;

/**
 * Read one file. Answers:
 *  - `bones`: every bone the take turns, parent first, each with its parent's index in this list and its rest place
 *    (metres, the file's own frame);
 *  - `restQ`: each of those bones' rest world rotation (x, y, z, w), for comparing two files' rest poses;
 *  - `clip`: the take as `ClipData` at the pack's rate;
 *  - `source`: what the file itself said (bones in all, frames, rate, seconds).
 */
export function readFbx(bytes) {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  // The loader says a line for every file about a property it does not read; the importer's report is not the place for them.
  const warn = console.warn;
  console.warn = () => {};
  let group;
  try {
    group = new FBXLoader().parse(ab, '');
  } finally {
    console.warn = warn;
  }
  const take = group.animations[0];
  if (!take) throw new Error('no animation in the file');
  group.updateMatrixWorld(true);
  const all = [];
  group.traverse((o) => { if (o.isBone) all.push(o); });
  if (!all.length) throw new Error('no skeleton in the file');
  const turned = new Set();
  let srcFrames = 0, srcFps = 0;
  for (const t of take.tracks) {
    const dot = t.name.lastIndexOf('.');
    if (t.name.slice(dot + 1) === 'quaternion') turned.add(t.name.slice(0, dot));
    if (t.times.length > srcFrames) {
      srcFrames = t.times.length;
      srcFps = t.times.length > 1 ? 1 / (t.times[1] - t.times[0]) : 0;
    }
  }
  if (!turned.size) throw new Error('the take turns no bone');
  // The bones the take turns, parent first, a bone's children by name: the files list one skeleton in more than one
  // order (a third of them walk the hips' children another way round), and the pack's order must not hang on which.
  const nearest = (b) => {
    let parent = b.parent;
    // The nearest ancestor the take turns: an end joint between two of them would otherwise orphan the child.
    while (parent && !(parent.isBone && turned.has(parent.name))) parent = parent.parent;
    return parent ?? null;
  };
  const childrenOf = new Map();
  const roots = [];
  for (const b of all) {
    if (!turned.has(b.name)) continue;
    const parent = nearest(b);
    if (!parent) roots.push(b);
    else (childrenOf.get(parent) ?? childrenOf.set(parent, []).get(parent)).push(b);
  }
  if (roots.length !== 1) throw new Error(`the skeleton has ${roots.length} roots the take turns`);
  const kept = [];
  const visit = (b) => {
    kept.push(b);
    for (const c of (childrenOf.get(b) ?? []).sort((x, y) => (stripPrefix(x.name) < stripPrefix(y.name) ? -1 : 1))) visit(c);
  };
  visit(roots[0]);
  const index = new Map(kept.map((b, i) => [b, i]));
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  const bones = [];
  const restQ = [];
  const restInv = [];
  for (const b of kept) {
    const parent = nearest(b);
    b.matrixWorld.decompose(p, q, s);
    bones.push({ name: stripPrefix(b.name), parent: parent ? index.get(parent) : -1, rest: [p.x * CM, p.y * CM, p.z * CM] });
    restQ.push([q.x, q.y, q.z, q.w]);
    restInv.push(q.clone().invert());
  }
  const hipsRest = new THREE.Vector3().setFromMatrixPosition(kept[0].matrixWorld);

  const duration = take.duration;
  if (!(duration > 0)) throw new Error('the take has no length');
  const frames = Math.max(2, Math.round(duration * PACK_FPS) + 1);
  const quats = new Float32Array(frames * kept.length * 4);
  const travel = new Float32Array(frames * 3);
  const mixer = new THREE.AnimationMixer(group);
  mixer.clipAction(take).play();
  const d = new THREE.Quaternion();
  for (let f = 0; f < frames; f++) {
    // Never the take's own length: a repeating action asked for exactly its end answers with its beginning, which
    // made every clip end as it began and read as a loop.
    mixer.setTime(Math.min(duration - 1e-5, frameTime(f, frames, duration)));
    group.updateMatrixWorld(true);
    for (let b = 0; b < kept.length; b++) {
      kept[b].matrixWorld.decompose(p, q, s);
      // The bone's world turn away from its rest: D = Rworld(t) * Rworld(rest)^-1.
      d.copy(q).multiply(restInv[b]).normalize();
      quats.set([d.x, d.y, d.z, d.w], (f * kept.length + b) * 4);
      if (b === 0) travel.set([(p.x - hipsRest.x) * CM, (p.y - hipsRest.y) * CM, (p.z - hipsRest.z) * CM], f * 3);
    }
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(group);
  continuousSign(quats, frames, kept.length);
  return {
    bones,
    restQ,
    clip: { frames, bones: kept.length, duration, quats, travel },
    source: { bones: all.length, frames: srcFrames, fps: Math.round(srcFps * 10) / 10, duration },
  };
}

/** How two files' rest poses differ, as words, or '' when they are one pose: the same joints in the same order, each within a millimetre and a tenth of a degree. */
export function restDifference(a, b) {
  if (a.bones.length !== b.bones.length) return `${b.bones.length} bones against ${a.bones.length}`;
  let worstP = 0, worstQ = 0, atP = '', atQ = '';
  for (let i = 0; i < a.bones.length; i++) {
    const x = a.bones[i], y = b.bones[i];
    if (x.name !== y.name || x.parent !== y.parent) return `bone ${i} is ${y.name}, not ${x.name}`;
    const dp = Math.hypot(x.rest[0] - y.rest[0], x.rest[1] - y.rest[1], x.rest[2] - y.rest[2]);
    if (dp > worstP) { worstP = dp; atP = x.name; }
    const qa = a.restQ[i], qb = b.restQ[i];
    const dq = (2 * Math.acos(Math.min(1, Math.abs(qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3]))) * 180) / Math.PI;
    if (dq > worstQ) { worstQ = dq; atQ = x.name; }
  }
  const words = [];
  if (worstP > 0.001) words.push(`${atP} rests ${(worstP * 100).toFixed(2)} cm away`);
  if (worstQ > 0.1) words.push(`${atQ} rests ${worstQ.toFixed(2)} degrees round`);
  return words.join(', ');
}
