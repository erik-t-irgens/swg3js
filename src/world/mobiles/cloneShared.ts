// A clone of a skinned model in which meshes that shared a skeleton go on sharing one (commit 3a).
//
// Three's `SkeletonUtils.clone` gives every skinned mesh of the clone a skeleton of its own
// (`sourceMesh.skeleton.clone()`), over the same bones and the same inverses. A dressed person is the
// body and a dozen worn pieces over one skeleton in its model, and came out of the clone as a dozen
// skeletons: each worked out and each uploaded to the card on its own, every time the body was drawn.
// Here a map from the model's skeleton to the clone's hands the same clone to every mesh that shared it,
// which is what the loader (one skeleton per skin) and `Character` (one across its parts) meant all
// along. Each mesh keeps its own bind matrix, as SkeletonUtils does.
//
// `SKELETON_TUNE.share` false is the old behaviour, three's own clone.
//
// Node tests run it (`skeletonShare.test.ts`), so value imports carry `.ts`.
import * as THREE from 'three';
import { clone as cloneEach } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { SKELETON_TUNE } from '../../core/skeletonOnce.ts';

function parallelTraverse(a: THREE.Object3D, b: THREE.Object3D, fn: (a: THREE.Object3D, b: THREE.Object3D) => void): void {
  fn(a, b);
  for (let i = 0; i < a.children.length; i++) parallelTraverse(a.children[i], b.children[i], fn);
}

/**
 * Clone `source` with its skeletons rebuilt over the clone's own bones: one clone per skeleton of the
 * model, shared by every mesh that shared it there. With `share` false, three's clone (a skeleton for
 * every mesh). Made once per body, when it is hung; nothing here runs on a frame.
 */
export function cloneShared<T extends THREE.Object3D>(source: T, share = SKELETON_TUNE.share): T {
  if (!share) return cloneEach(source) as T;
  const sourceOf = new Map<THREE.Object3D, THREE.Object3D>();
  const cloneOf = new Map<THREE.Object3D, THREE.Object3D>();
  const clone = source.clone() as T;
  parallelTraverse(source, clone, (s, c) => {
    sourceOf.set(c, s);
    cloneOf.set(s, c);
  });
  const skeletons = new Map<THREE.Skeleton, THREE.Skeleton>();
  clone.traverse((node) => {
    const mesh = node as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const src = sourceOf.get(mesh) as THREE.SkinnedMesh;
    const from = src.skeleton;
    let skeleton = skeletons.get(from);
    if (!skeleton) {
      // Three's own `Skeleton.clone` keeps the inverses by reference, as this does: they never change.
      skeleton = new THREE.Skeleton(
        from.bones.map((b) => cloneOf.get(b) as THREE.Bone),
        from.boneInverses,
      );
      skeletons.set(from, skeleton);
    }
    mesh.bind(skeleton, src.bindMatrix);
  });
  return clone;
}

/** Whether two skeletons stand on the very same bones, in the same order, with the same inverses. */
function sameBones(a: THREE.Skeleton, b: THREE.Skeleton): boolean {
  if (a === b) return true;
  if (a.bones.length !== b.bones.length) return false;
  for (let i = 0; i < a.bones.length; i++) if (a.bones[i] !== b.bones[i]) return false;
  if (a.boneInverses === b.boneInverses) return true;
  for (let i = 0; i < a.boneInverses.length; i++) if (!a.boneInverses[i].equals(b.boneInverses[i])) return false;
  return true;
}

/**
 * The switch flipped on a body already hung, so the frame report can put the two side by side in one
 * session: `share` gives every skinned mesh standing on the same bones one skeleton (the first one met),
 * and without it every mesh after the first takes a skeleton of its own, as three's clone gives. A
 * skeleton no mesh stands on any more has its bone texture let go. Answers how many skeletons the body
 * has now. Called from the console's switch, never on a frame of its own.
 */
export function reshareSkeletons(root: THREE.Object3D, share: boolean): number {
  const kept: THREE.Skeleton[] = [];
  const dropped = new Set<THREE.Skeleton>();
  root.traverse((node) => {
    const mesh = node as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || !mesh.skeleton) return;
    const own = mesh.skeleton;
    if (share) {
      const same = kept.find((k) => sameBones(k, own));
      if (!same) {
        kept.push(own);
        return;
      }
      if (same !== own) {
        dropped.add(own);
        mesh.bind(same, mesh.bindMatrix);
      }
      return;
    }
    if (!kept.includes(own)) {
      kept.push(own);
      return;
    }
    const alone = new THREE.Skeleton(own.bones, own.boneInverses);
    kept.push(alone);
    mesh.bind(alone, mesh.bindMatrix);
  });
  for (const s of dropped) if (!kept.includes(s)) s.dispose();
  return kept.length;
}
