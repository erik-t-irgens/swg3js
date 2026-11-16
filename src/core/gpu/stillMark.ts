// What the port's patches call still (the GPU port's step 3): a thing that never moves and whose material is never
// changed in play, so three's per-draw refresh of its programs can be left to three's own comparison. Three has a mark
// of its own (`Object3D.static`), but it also skips that comparison, so a still thing's instance matrices written in
// place (a folded row hidden by the world editor) would never reach the GPU: the game's mark is its own, kept on the
// object's userData, and set only by the bundles (`bundles.ts`) on the region tiers' meshes they take, before those
// meshes' programs are built.

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Whether an object is still in the patches' sense: three's own mark, or the bundles' (`markStill`). */
export function isStill(o: Any): boolean {
  return !!o && (o.static === true || o.userData?.gpuStill === true);
}

/** Mark an object still (the bundles, for a tier mesh they will take). */
export function markStill(o: Any, on = true): void {
  if (on) o.userData.gpuStill = true;
  else delete o.userData.gpuStill;
}
