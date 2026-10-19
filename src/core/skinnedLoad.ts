// What every skinned mesh is made into as it loads (the performance pass's second wave), before anything draws it.
//
// Two passes over a loaded model, both at load, in a GLTF loader plugin's `afterRoot` (`skinnedPlugin`):
//
//  1. **Float32 joints** (`floatJoints`). The converter writes a skinned vertex's joint indices as unsigned shorts and
//     three hands them to a float attribute in the shader as they are; on Direct3D 11 that input layout makes ANGLE
//     build a second vertex shader on the GPU process the first time each skinned program draws, 25 to 57 ms of the
//     whole browser stalled at every body's first sight, every session, and in no cache. Stored as floats of the same
//     values, the layout is the one the program was built for. Eight more bytes a skinned vertex; no program key
//     changes (three keys nothing on an attribute's type). An attribute already uploaded cannot change type in place
//     and replacing it would orphan its buffer, so a geometry some frame has drawn is left as it is and counted.
//  2. **The morph ladder** (`padMorphs`). Every skinned primitive's morph count is padded with zero targets up to the
//     next rung of `PERSON_KEYS_TUNE.morphLadder` (0, 7, 33), so the counts in the program keys come to three and the
//     warm lists made from them (the motion blur's variants, the skinned depth combinations) are closed and ours. A
//     zero target at an influence of nought moves no vertex. The loader has already built each mesh and its
//     `morphTargetInfluences` by `afterRoot`, so every built mesh on a padded geometry has its influences extended
//     with zeros in the same step: padded only in the geometry, every CPU vertex path (`getVertexPosition`, a skinned
//     mesh's bounding sphere, the raycasts, the saddle) reads an undefined influence and comes out NaN.
//     `updateMorphTargets()` is never called, since it would rename the targets '0' to 'n' and lose the glTF names the
//     body sliders read. A geometry is padded once however many meshes share it; a count past the top keeps its own.
//
// Each is behind a `localStorage` hatch read once at load (`swg.floatJoints`, `swg.morphLadder`), compared over two
// sessions. Every new GLTF loader that can load a skinned mesh goes through `surfaces.withPlugin` or registers
// `skinnedPlugin` itself (held by a text test); the rig's animation-only loader is exempt. Pure but for three; node
// loads it.
import * as THREE from 'three';
import { MORPH_LADDER_ON, PERSON_KEYS_TUNE, morphRung, readHatch } from '../world/personKeys.ts';

/**
 * The two hatches, read once at load: on unless `localStorage` says '0'. Printed by `__debug.skinnedLoad()`. The
 * ladder's is `personKeys.ts`'s own, which the warm lists read too, so with it off they are the first wave's.
 */
export const SKINNED_LOAD: { readonly floatJoints: boolean; readonly morphLadder: boolean } = Object.freeze({
  floatJoints: readHatch('swg.floatJoints'),
  morphLadder: MORPH_LADDER_ON,
});

/** What the plugin has done this session, for `__debug.skinnedLoad()`. */
export const SKINNED_STATS = {
  /** Joint attributes widened to floats. */
  joints: 0,
  /** Geometries padded, and to which rung. */
  padded: 0,
  byRung: {} as Record<number, number>,
  /** Built meshes whose influences were extended. */
  influences: 0,
  /**
   * Geometries met already drawn, left as they were. Nought by construction in the game, and so no check: the only
   * caller is the loader plugin, which widens every model's joints before any frame can upload them, so no joint
   * attribute it meets has ever been drawn. It guards a caller that would widen a model a frame has drawn, which none
   * does; `noteUploaded` is how a test reaches it.
   */
  metDrawn: 0,
  /** Geometries past the ladder's top, which keep their own count. */
  pastTop: 0,
};

/** Attributes some frame has uploaded: three calls an attribute's `onUploadCallback` as it first uploads it. */
const uploaded = new WeakSet<object>();
function markUploaded(this: THREE.BufferAttribute): void {
  uploaded.add(this);
}

/**
 * Note an attribute as uploaded by a frame (what three's upload of it does through `onUploadCallback`): a geometry
 * whose joints are so marked is never widened. The plugin hangs the marker on every joint attribute it leaves.
 */
export function noteUploaded(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): void {
  uploaded.add(attr);
}

/** Whether a frame has uploaded this attribute (as far as the plugin's marker or `noteUploaded` knows). */
export function wasUploaded(attr: object): boolean {
  return uploaded.has(attr);
}

/** Joint indices as a float attribute of the same values and item size, marked to say when a frame uploads it. */
export function floatSkinIndex(values: ArrayLike<number>, itemSize: number): THREE.Float32BufferAttribute {
  const out = new THREE.Float32BufferAttribute(Float32Array.from(values), itemSize);
  out.onUpload(markUploaded);
  return out;
}

/**
 * Every skinned mesh's joint indices under `root` stored as floats (see the file's head). A geometry whose joints a
 * frame has uploaded already is left and counted; one already Float32 is left; an interleaved one is read out whole.
 * Answers how many attributes were widened.
 */
export function floatJoints(root: THREE.Object3D): number {
  let n = 0;
  const seen = new Set<THREE.BufferGeometry>();
  root.traverse((o) => {
    const s = o as THREE.SkinnedMesh;
    if (!s.isSkinnedMesh || !s.geometry || seen.has(s.geometry)) return;
    seen.add(s.geometry);
    const g = s.geometry;
    const attr = g.getAttribute('skinIndex') as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
    if (!attr) return;
    if ((attr as THREE.BufferAttribute).array instanceof Float32Array && !(attr as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) {
      // Already floats: only the marker, so a later pass knows when a frame has drawn it.
      if (!(attr as THREE.BufferAttribute).onUploadCallback || (attr as THREE.BufferAttribute).onUploadCallback === THREE.BufferAttribute.prototype.onUploadCallback) (attr as THREE.BufferAttribute).onUpload(markUploaded);
      return;
    }
    if (uploaded.has(attr)) {
      SKINNED_STATS.metDrawn++;
      return;
    }
    const size = attr.itemSize;
    const values = new Float32Array(attr.count * size);
    for (let i = 0; i < attr.count; i++) for (let c = 0; c < size; c++) values[i * size + c] = attr.getComponent(i, c);
    const out = new THREE.Float32BufferAttribute(values, size);
    out.onUpload(markUploaded);
    g.setAttribute('skinIndex', out);
    n++;
  });
  SKINNED_STATS.joints += n;
  return n;
}

/**
 * Every skinned primitive under `root` padded to its rung of `ladder` (see the file's head), and every built mesh on a
 * padded geometry given influences as long as its geometry's targets, the padding at nought. Idempotent: a count on a
 * rung already is left; a geometry is padded once however many meshes share it. Answers how many geometries it padded.
 */
export function padMorphs(root: THREE.Object3D, ladder: readonly number[] = PERSON_KEYS_TUNE.morphLadder): number {
  let n = 0;
  const done = new Set<THREE.BufferGeometry>();
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    const s = o as THREE.SkinnedMesh;
    if (!s.isSkinnedMesh || !s.geometry) return;
    meshes.push(s);
    const g = s.geometry;
    if (done.has(g)) return;
    done.add(g);
    const pos = g.morphAttributes.position;
    const count = pos?.length ?? 0;
    if (count === 0) return;
    const rung = morphRung(count, ladder);
    if (rung === count) {
      if (count > ladder[ladder.length - 1]) SKINNED_STATS.pastTop++;
      return;
    }
    // One zero array for the whole geometry: every padded target of each kind reads the same nought.
    const vertices = pos![0].count;
    const zeros3 = new Float32Array(vertices * 3);
    const pad = (list: (THREE.BufferAttribute | THREE.InterleavedBufferAttribute)[] | undefined, size: number): void => {
      if (!list || list.length !== count) return;
      const fill = size === 3 ? zeros3 : new Float32Array(vertices * size);
      for (let i = count; i < rung; i++) list.push(new THREE.BufferAttribute(fill, size));
    };
    pad(g.morphAttributes.position, 3);
    pad(g.morphAttributes.normal, 3);
    const colours = g.morphAttributes.color;
    if (colours?.length) pad(colours, colours[0].itemSize);
    n++;
    SKINNED_STATS.byRung[rung] = (SKINNED_STATS.byRung[rung] ?? 0) + 1;
  });
  // Every built mesh on a geometry with more targets than it has influences: the new ones at nought, and never a name.
  for (const m of meshes) {
    const targets = m.geometry.morphAttributes.position?.length ?? 0;
    const inf = m.morphTargetInfluences;
    if (!inf || inf.length >= targets) continue;
    for (let i = inf.length; i < targets; i++) inf.push(0);
    SKINNED_STATS.influences++;
  }
  SKINNED_STATS.padded += n;
  return n;
}

/** Both passes over a loaded model, each as its hatch says. */
export function prepareSkinned(root: THREE.Object3D): void {
  if (SKINNED_LOAD.floatJoints) floatJoints(root);
  if (SKINNED_LOAD.morphLadder) padMorphs(root);
}

/** The loader plugin: both passes in `afterRoot`, before anything has drawn the model. */
export function skinnedPlugin(): { name: string; afterRoot: (result: { scene: THREE.Object3D }) => null } {
  return {
    name: 'SWG_skinned_load',
    afterRoot: (result) => {
      if (result?.scene) prepareSkinned(result.scene);
      return null;
    },
  };
}
