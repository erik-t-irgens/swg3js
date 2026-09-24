// How the creator's camera moves: in and out along one line, and up and down when it is close.
//
// The camera of a captured shot is the **furthest out the creator ever goes**. That is not a
// limitation, it is what makes the scene small enough to exist: the bake carries only what that one
// frustum can see, so a camera that pulled back further, or swung to the side, would be looking at
// ground nobody built. Zooming only ever brings it nearer, which can show less and never more.
//
// Two things follow from that and are worth saying plainly.
//
// **At full zoom out the composition is exactly the one that was captured.** Every adjustment here
// is scaled by how far in the view has come, so at the far limit the pan contributes nothing and
// the camera sits precisely where the owner stood when they liked the view.
//
// **The face is reached by turning the figure, not by moving the camera.** These shots are all over
// the shoulder, so the near end of this line is the back of a head. Spinning the figure half a turn
// and sliding the view up is what puts a face in front of the camera, which is why the pan exists
// at all and why its range grows as the camera closes in.

/** Where the view has been moved to. Nothing here is an angle the player chose: the line is the shot's. */
export interface SceneView {
  /** 0 at the captured camera, 1 at the closest the creator allows. */
  zoom: number;
  /** How far the view has slid up or down, in metres at the figure. Positive is up. */
  pan: number;
  /** The figure's own turn, in radians, from the facing it was captured at. */
  spin: number;
}

/**
 * Every invented number of the creator's camera. The client had no such camera, so none of this is
 * the game's. Live through `__debug.sceneView`.
 */
export const SCENE_VIEW_TUNE = {
  /** The closest the camera comes to what it is looking at, in metres. A head fills the view here. */
  minDistance: 0.55,
  /** How far up or down the view may slide at full zoom, in metres. Enough to reach a head or a pair of boots. */
  panMax: 1.1,
  /** Metres of pan per pixel dragged, at full zoom. */
  panPerPixel: 0.004,
  /** Radians of spin per pixel dragged. The doll's own rate, so turning a figure feels the same in both places. */
  spinPerPixel: 0.011,
  /** How much of the remaining zoom one notch of the wheel takes. */
  zoomStep: 0.08,
};

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * How far the camera stands from what it is looking at.
 *
 * Geometric rather than linear, so a notch of the wheel changes the view by the same *proportion*
 * wherever it is. Linear steps crawl when the camera is far and leap when it is near, which is the
 * one thing that makes a zoom feel broken.
 */
export function distanceFor(zoom: number, far: number, tune = SCENE_VIEW_TUNE): number {
  const near = Math.min(tune.minDistance, far);
  const t = clamp(Number.isFinite(zoom) ? zoom : 0, 0, 1);
  return far * (near / far) ** t;
}

/**
 * How far the view may slide up or down at this zoom: nothing at all at the far limit, growing to
 * the whole range as the camera closes in.
 *
 * Scaled rather than switched on at a threshold. A pan that appeared suddenly would jump the view
 * the first time it was allowed, and the captured composition has to be exactly itself at zoom 0.
 */
export function panRange(zoom: number, tune = SCENE_VIEW_TUNE): number {
  return tune.panMax * clamp(Number.isFinite(zoom) ? zoom : 0, 0, 1);
}

/** Hold a view inside what it is allowed to be. The pan is clamped against its own zoom's range. */
export function clampView(view: SceneView, tune = SCENE_VIEW_TUNE): SceneView {
  const zoom = clamp(Number.isFinite(view.zoom) ? view.zoom : 0, 0, 1);
  const range = panRange(zoom, tune);
  const spin = Number.isFinite(view.spin) ? view.spin : 0;
  return {
    zoom,
    pan: clamp(Number.isFinite(view.pan) ? view.pan : 0, -range, range),
    // Kept inside one turn so a figure spun round twenty times does not carry a huge number about.
    spin: spin - Math.floor(spin / (Math.PI * 2)) * (Math.PI * 2),
  };
}

/**
 * Where the camera stands and what it looks at, in the place's own frame, where the figure's feet
 * are the origin.
 *
 * `orbit` is the shot's own yaw, pitch and distance, as `orbitFor` reads them off the capture, and
 * `eyeHeight` is how high the view is centred over the feet. The returned pose is what the game's
 * camera is written with directly: nothing downstream has to know a zoom from a pan.
 */
export function viewPose(
  orbit: { yaw: number; pitch: number; distance: number },
  view: SceneView,
  eyeHeight: number,
  tune = SCENE_VIEW_TUNE,
): { camera: { x: number; y: number; z: number }; look: { x: number; y: number; z: number }; distance: number } {
  const v = clampView(view, tune);
  const distance = distanceFor(v.zoom, orbit.distance, tune);
  // What the camera is aimed at: the eyes, slid up or down by the pan.
  const look = { x: 0, y: eyeHeight + v.pan, z: 0 };
  const cp = Math.cos(orbit.pitch);
  return {
    camera: {
      x: look.x + Math.sin(orbit.yaw) * cp * distance,
      y: look.y + Math.sin(orbit.pitch) * distance,
      z: look.z + Math.cos(orbit.yaw) * cp * distance,
    },
    look,
    distance,
  };
}

/** The wheel: a notch takes a share of whatever is left, in or out. */
export function zoomBy(view: SceneView, notches: number, tune = SCENE_VIEW_TUNE): SceneView {
  return clampView({ ...view, zoom: view.zoom + notches * tune.zoomStep }, tune);
}

/** A left drag turns the figure; a right drag slides the view, as far as this zoom allows. */
export function dragView(view: SceneView, dx: number, dy: number, right: boolean, tune = SCENE_VIEW_TUNE): SceneView {
  if (right) return clampView({ ...view, pan: view.pan + dy * tune.panPerPixel }, tune);
  return clampView({ ...view, spin: view.spin - dx * tune.spinPerPixel }, tune);
}

/** The view a screen opens on: the captured shot exactly, with the figure as it was captured. */
export function restView(): SceneView {
  return { zoom: 0, pan: 0, spin: 0 };
}
