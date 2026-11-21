// The camera's jitter for the edge smoothing (the GPU port's pass 1, wave 6; the design's section 6). The smoothing gathers the
// picture over several frames, each drawn from a camera nudged by a different fraction of a pixel, so an edge that one frame
// draws stepped is drawn at sixteen places in turn and averaged. Three jitters only inside its own `RenderPipeline`, which the
// port does not use, so the jitter is the game's: a view offset on the camera (`setViewOffset`'s own record, written in place)
// round the portal renderer's passes and the weather
// (`main.ts`'s frame, through the runtime's `taa.begin` and `taa.end`), the projection put back exactly as it stood after the
// chain, so a pick, the interface's marks and every read of the camera between frames see the camera as the game set it.
//
// The offsets are the Halton sequence in bases 2 and 3 (the usual choice: a low-discrepancy cover of the pixel that is good at
// every length), sixteen of them, in pixels of the scene target about its centre. The motion buffer is written unjittered:
// `motion.ts` reads the projection kept here (`unjitteredProjection`) as the frame's own.
//
// The approach follows three's `TRAANode` and `TAAUNode` (three.js, MIT, `LICENSES/three-MIT.txt`), written over the game's
// camera rather than three's pipeline. Nothing here is loaded on the WebGL path.

import * as THREE from 'three';

/** The radical inverse of `i` in `base` (the Halton sequence's element). */
export function radicalInverse(i: number, base: number): number {
  let f = 1;
  let r = 0;
  let n = i;
  while (n > 0) {
    f /= base;
    r += f * (n % base);
    n = Math.floor(n / base);
  }
  return r;
}

/** How many offsets the jitter cycles through. */
export const JITTER_LENGTH = 16;

/**
 * The offsets in pixels about the pixel's centre, x then y, each in -0.5..0.5: Halton(2, 3) from its first element (the zeroth
 * is the corner), made once as this module loads.
 */
export const JITTER_OFFSETS: Float64Array = (() => {
  const out = new Float64Array(JITTER_LENGTH * 2);
  for (let i = 0; i < JITTER_LENGTH; i++) {
    out[i * 2] = radicalInverse(i + 1, 2) - 0.5;
    out[i * 2 + 1] = radicalInverse(i + 1, 3) - 0.5;
  }
  return out;
})();

/** The jitter now: whether the camera is nudged, by how many pixels of a target how big, and which offset of the cycle. */
export const JITTER = {
  on: false,
  /**
   * Pixels rightward and downward (a texel of the target from its top-left, as WebGPU counts them). Begun as fractions: a field
   * begun as a whole number boxes every fraction written into it after (`grapple.md`).
   */
  x: 0.25,
  y: 0.25,
  width: 1,
  height: 1,
  index: 0,
  /** Frames jittered since load, and frames whose jitter had to be taken off at the next begin (an exception mid-frame). */
  frames: 0,
  stale: 0,
};

/** The camera's projection as the game set it, kept while it is nudged, and its inverse. */
const KEPT_P = new THREE.Matrix4();
const KEPT_PI = new THREE.Matrix4();
let keptCamera: THREE.PerspectiveCamera | null = null;

/**
 * Nudge the camera for this frame's draws into a target `width` by `height` (the scene target's size, which under the upscaled
 * smoothing is smaller than the canvas): the next offset of the cycle, as a view offset over the whole frame. A camera still nudged
 * (a frame that threw before its end) is put back first, so the projection kept is always the game's own. Nothing allocated but
 * the camera's view record, once.
 */
export function jitterBegin(camera: THREE.PerspectiveCamera, width: number, height: number): void {
  if (JITTER.on) {
    JITTER.stale++;
    jitterEnd();
  }
  const i = JITTER.index;
  KEPT_P.copy(camera.projectionMatrix);
  KEPT_PI.copy(camera.projectionMatrixInverse);
  keptCamera = camera;
  // `setViewOffset`'s own effect, written into its record and worked out by the camera's own `updateProjectionMatrix`: a fraction
  // handed to a call the compiler does not build in is a number made (half of a dozen node processes boxed the two offsets as
  // `setViewOffset`'s arguments, 31 bytes a frame), and three makes the record with whole numbers in its offsets, which boxes every
  // fraction written into them after; so the record is made here, its offsets begun as fractions, in three's own fields and order.
  if (camera.view === null) camera.view = { enabled: true, fullWidth: 1, fullHeight: 1, offsetX: 0.25, offsetY: 0.25, width: 1, height: 1 };
  const v = camera.view;
  // A view offset of +x pixels moves the window right, so the picture moves left: the pixel whose centre is at m + 0.5 shows what
  // the unnudged camera shows at m + 0.5 + x (and likewise downward for y). `JITTER.x` and `y` are that x and y.
  v.enabled = true;
  v.fullWidth = width;
  v.fullHeight = height;
  v.offsetX = JITTER_OFFSETS[i * 2];
  v.offsetY = JITTER_OFFSETS[i * 2 + 1];
  v.width = width;
  v.height = height;
  camera.updateProjectionMatrix();
  JITTER.on = true;
  JITTER.x = JITTER_OFFSETS[i * 2];
  JITTER.y = JITTER_OFFSETS[i * 2 + 1];
  JITTER.width = width;
  JITTER.height = height;
  JITTER.frames++;
}
/** The camera put back exactly as the game set it (its kept projection, never one worked out again), and the cycle moved on. */
export function jitterEnd(): void {
  if (!JITTER.on || keptCamera === null) return;
  const camera = keptCamera;
  // `clearViewOffset` turns the view off and works the projection out again; the kept one is copied over it, so a field the
  // game set without asking for a new projection (none does today) cannot reach the frame early.
  camera.clearViewOffset();
  camera.projectionMatrix.copy(KEPT_P);
  camera.projectionMatrixInverse.copy(KEPT_PI);
  keptCamera = null;
  JITTER.on = false;
  JITTER.index = (JITTER.index + 1) % JITTER_LENGTH;
}

/** The camera's projection as the game set it: the kept one while the camera is nudged (`motion.ts`'s frame reads it). */
export function unjitteredProjection(camera: THREE.Camera): THREE.Matrix4 {
  return JITTER.on && keptCamera === camera ? KEPT_P : camera.projectionMatrix;
}

/** For the node tests: the cycle from its start, nothing nudged. */
export function resetJitterForTests(): void {
  JITTER.on = false;
  JITTER.index = 0;
  JITTER.frames = 0;
  JITTER.stale = 0;
  keptCamera = null;
}
