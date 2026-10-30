// Whether the page draws with reversed depth: the near plane at 1 and the far at 0, in a floating-point buffer, so
// depth keeps its precision all the way out instead of losing it with the square of the distance (docs/REVERSED-DEPTH.md).
//
// On by default wherever the browser can do it; `?norevz` in the address turns it off, to compare. Decided once, when
// the page loads, because a few shaders' text is assembled when their files are first imported -- before the renderer
// exists -- and must stay byte for byte as it was when this is off, so their programs keep their keys
// (grassAir.test.ts holds the grass's to its old text, airClouds.test.ts the clouds'). And decided by asking a
// throwaway context for EXT_clip_control, not assumed: without it three falls back to ordinary depth, and shaders
// chosen for reversed depth would then draw wrong for a player who never asked for anything. Node has no document,
// so the tests see it off unless they stand one in (reversedDepthOn.test.ts).

/** Whether this browser's WebGL2 offers EXT_clip_control, asked of a context made and lost at once. */
function clipControlOffered(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return false;
    const offered = gl.getExtension('EXT_clip_control') !== null;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return offered;
  } catch {
    return false;
  }
}

/** True when the page draws with reversed depth: wanted (no `?norevz`) and offered (EXT_clip_control). */
export const REVERSED_DEPTH = typeof location !== 'undefined' && !new URLSearchParams(location.search).has('norevz') && clipControlOffered();

/**
 * Whether a point projected by this camera (`Vector3.project`) lies behind it or past its far plane. Ordinarily that
 * is a depth above 1; under reversed depth it is below 0 (and above 1 is nearer than the near plane). Asked of the
 * camera, not the page's flag, because a camera is reversed only once a reversed renderer has drawn it: the map
 * screen's own renderer never reverses its camera. Under reversed depth `z > 1` never caught a target behind you, so
 * its box was drawn where its mirrored projection fell -- in front of you.
 */
export function projectedBehind(z: number, camera: { reversedDepth?: boolean }): boolean {
  return camera.reversedDepth === true ? z < 0 : z > 1;
}
