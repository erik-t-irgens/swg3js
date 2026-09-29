// A skeleton worked out once a frame, not once a render call (commit 3b of the frame-time wave).
//
// Three updates a skinned mesh's skeleton once per value of its own frame counter, and that counter
// goes up once per `renderer.render()` -- after the scene is projected, so the shadow maps drawn inside
// the same call update every casting skeleton a second time. The portal renderer makes a render call
// for the shadows, the world and each building seen through its doors, so a crowd's bones were worked
// out three to six times a frame, and every one of those set the bone texture's `needsUpdate`, which is
// an upload the next time the mesh is drawn. Nothing moves a bone between the passes of one frame
// (CLAUDE.md: nothing may move a transform between them), so every run after the first recomputed the
// same matrices and sent the same bytes.
//
// `Skeleton.prototype.update` is patched once, here. While a frame is open (`SKELETON_FRAME.active`,
// set by `PortalRenderer.render` at its top and cleared in its `finally`) a skeleton already worked out
// under this frame's number is skipped: no matrices, no `needsUpdate`, no upload. The first pass of a
// frame always runs it, after the scene's matrices are walked, so the bones are fresh. Outside a frame
// -- the character previews, the wardrobe doll, a measurement of a posed body -- every call does what
// three's own does. `SKELETON_TUNE.once` false is the old behaviour.
//
// The frame report reads the counts through the two hooks, which is also the only way it counts a
// skeleton at all: one patch on the prototype, never two wrappers whose order would decide what counts.
//
// Node tests run it (`skeletonShare.test.ts`), so value imports carry `.ts`.
import * as THREE from 'three';

/** The three changes of step 3 and the sphere the per-mesh cull keeps. Every number is ours. */
export const SKELETON_TUNE = {
  /** A mobile's meshes that shared one skeleton in the model share one in its clone (commit 3a). */
  share: true,
  /** A skeleton is worked out once a frame inside the portal renderer's passes (commit 3b). */
  once: true,
  /** A body's meshes are culled one by one, in every pass and cascade, against a sphere set once (commit 3c). */
  cullSphere: true,
  /** How much the body's own cull sphere is grown for each mesh, for a limb, a tail or a swing that reaches past it. */
  sphereScale: 1.15,
};

/** The frame the renderer has open, and what the skeletons did in the frames so far. */
export const SKELETON_FRAME = {
  active: false,
  /** Which frame is open: a skeleton stamped with it has been worked out already. */
  n: 0,
  /** Every real update and every skip since the session began (the frame report counts its own per frame). */
  updated: 0,
  skipped: 0,
};

/** What the frame report is told of each update and each skip; null counts nothing. */
export const SKELETON_HOOKS: { updated: ((s: THREE.Skeleton) => void) | null; skipped: (() => void) | null } = { updated: null, skipped: null };

type Stamped = THREE.Skeleton & { onceStamp?: number };
type PatchedProto = THREE.Skeleton & { oncePatched?: boolean };

/** Patch `Skeleton.prototype.update` once, for the whole page. Safe to call again. */
export function installSkeletonOnce(): void {
  const proto = THREE.Skeleton.prototype as PatchedProto;
  if (proto.oncePatched) return;
  proto.oncePatched = true;
  const original = proto.update;
  proto.update = function update(this: Stamped): void {
    const f = SKELETON_FRAME;
    if (f.active && SKELETON_TUNE.once) {
      if (this.onceStamp === f.n) {
        f.skipped++;
        const skipped = SKELETON_HOOKS.skipped;
        if (skipped !== null) skipped();
        return;
      }
      this.onceStamp = f.n;
    }
    f.updated++;
    original.call(this);
    const updated = SKELETON_HOOKS.updated;
    if (updated !== null) updated(this);
  };
}

/** A frame's passes begin: every skeleton is worked out on its first draw of the frame and not again. */
export function beginSkeletonFrame(): void {
  SKELETON_FRAME.n++;
  SKELETON_FRAME.active = true;
}

/** The passes are over: from here to the next frame every update runs, as three's own does. */
export function endSkeletonFrame(): void {
  SKELETON_FRAME.active = false;
}
