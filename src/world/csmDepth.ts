// The sun's cascades under reversed depth (docs/REVERSED-DEPTH.md).
//
// Three's cascades (`CSM`) work the camera's frustum out by un-projecting the screen's corners at depths -1 and 1, and
// never tell their frustum when the camera is reversed, though `CSMFrustum` itself knows the 1 and 0 a reversed camera
// needs (`data.reversedDepth`). Un-projected at the wrong depths a reversed camera's frustum collapses -- its near corner
// behind the eye, its far one at no distance -- and the cascades, fitted to it, cast nothing. The first world's split
// ran before the camera had been drawn reversed, so its shadows were right; every later `updateFrustums` (a new
// location, a shadow setting) lost them for good. So the frustum's depths are set from the camera each time.
//
// Imports three's types only, so node's test drives it with the real CSM (reversedDepth.test.ts).
import type * as THREE from 'three';

/** What of three's CSM this reads and wraps. */
interface Cascades {
  mainFrustum: unknown;
  updateFrustums(): void;
}

/** Make `updateFrustums` set the main frustum's depths from the camera before every split, then split once now. */
export function followCameraDepth(csm: Cascades, camera: THREE.Camera): void {
  const split = csm.updateFrustums.bind(csm);
  const main = csm.mainFrustum as { zNear: number; zFar: number };
  csm.updateFrustums = () => {
    const reversed = camera.reversedDepth === true;
    main.zNear = reversed ? 1 : -1;
    main.zFar = reversed ? 0 : 1;
    split();
  };
  csm.updateFrustums();
}
