// Registering a rendered backdrop with the camera that is drawn over it.
//
// A creation or selection backdrop is one of the owner's captured shots **rendered once** rather
// than built again every time the screen opens. That is not a shortcut, it is the shape of the
// problem: the camera in these shots never moves, so no parallax is possible and a picture of the
// place is not an approximation of the place, it is the place. It also costs about two megabytes
// where carrying the geometry costs a hundred and fifty (measured over the owner's own packs: the
// models a single Theed shot can see are 150 MB of textured GLB, and 1.3 GB over the seventeen
// shots, which no selection screen can afford to fetch).
//
// What has to be exact is the **registration**: the figure is drawn live in three dimensions over
// a picture taken by another camera, and if the two projections disagree by a per cent the
// character's feet leave the ground. They agree when the live camera is the shot's own camera --
// same place, same look-at, same vertical field of view -- and the picture is laid over the view
// at the scale its own field of view asks for. That scale is what this file works out, and it is
// pure arithmetic so a node test can sweep it rather than anybody eyeballing a seam.
//
// The picture is deliberately rendered **wider and taller than any window**, because a window can
// be any shape and a backdrop that runs out at the edge is worse than one with margin to spare.
// The live camera keeps the shot's vertical field of view whatever the window does (three's
// perspective camera does this by itself: the vertical angle is fixed and the aspect only widens
// the horizontal), so a wider window shows more of the picture sideways and a taller one shows
// less. Everything here follows from that one fact.

/** How a backdrop was rendered: the angles it covers, which is all the registration needs. */
export interface BackdropRender {
  /** Vertical field of view in degrees, at least the shot's own and usually more, for margin. */
  fov: number;
  /** Width over height of the rendered picture. */
  aspect: number;
  /** The pixels it was rendered at, kept so a re-render can be told from the same shot at another size. */
  width: number;
  height: number;
}

/** The view it is being drawn under: the live camera and the window. */
export interface BackdropView {
  /** The live camera's vertical field of view in degrees. This is the shot's own, always. */
  fov: number;
  /** The viewport's width over height. */
  aspect: number;
}

/**
 * How large to draw the picture, as a multiple of the viewport, so that a point in it lands where
 * the live camera would put the same point in the world.
 *
 * Both projections are rectilinear, so a direction `theta` off the middle lands at
 * `tan(theta) / tan(fov / 2)` of the way to the edge in either. The picture's own half-angles are
 * therefore the whole of it: the scale is one projection's tangent over the other's, per axis.
 */
export function backdropFit(render: BackdropRender, view: BackdropView): { scaleX: number; scaleY: number; covers: boolean } {
  const half = (deg: number): number => Math.tan((Math.max(1e-3, Math.min(179, deg)) * Math.PI) / 360);
  const rv = half(render.fov);
  const vv = half(view.fov);
  const rh = rv * Math.max(1e-6, render.aspect);
  const vh = vv * Math.max(1e-6, view.aspect);
  const scaleY = rv / vv;
  const scaleX = rh / vh;
  // A hair under one is still a gap at the edge, so the test is honest rather than generous.
  return { scaleX, scaleY, covers: scaleX >= 1 && scaleY >= 1 };
}

/**
 * How to render a shot so its picture covers every window worth planning for.
 *
 * **The vertical field of view is the shot's own and never more**, which is worth saying because
 * the instinct is to render wide in both directions for margin. A perspective camera's vertical
 * angle does not change with the window: three holds the vertical fixed and lets the aspect widen
 * the horizontal, so however tall or narrow the window is, the picture's vertical registration is
 * exact at the shot's own angle and margin up and down would only be thrown away. All the margin
 * that can ever be used is sideways, and that is the aspect's to give.
 *
 * So there is one real choice here: the widest window to support. Past it the picture runs out at
 * the sides, which `backdropFit` reports rather than hiding.
 */
export function backdropRenderFor(shotFov: number, widestViewAspect: number, height: number): BackdropRender {
  const aspect = Math.max(1, widestViewAspect);
  const h = Math.max(16, Math.round(height));
  return { fov: shotFov, aspect, width: Math.round(h * aspect), height: h };
}

/** A point, in whatever frame the thing holding it is in. */
export interface ScenePoint {
  x: number;
  y: number;
  z: number;
}

/**
 * A shot as the doll's own preview has to hold it: the camera and the look-at point moved into the
 * frame the figure already stands in, and the turn that leaves the figure facing as it was captured.
 *
 * The preview stands its doll at the origin with the feet on the floor and spins it there, so the
 * world coordinates of a shot are no use to it directly. Subtracting the standing spot moves the
 * whole composition into that frame without changing a single angle or distance, which is what
 * keeps the registration exact: the camera is the same camera, it is simply described from the
 * figure's feet instead of from the middle of a planet.
 */
export function sceneView(shot: { stand: { x: number; y: number; z: number; heading: number }; camera: { x: number; y: number; z: number; look: ScenePoint } }): { camera: ScenePoint; look: ScenePoint; faceYaw: number } {
  const s = shot.stand;
  const c = shot.camera;
  const camera = { x: c.x - s.x, y: c.y - s.y, z: c.z - s.z };
  const look = { x: c.look.x - s.x, y: c.look.y - s.y, z: c.look.z - s.z };
  // The doll is modelled facing +Z and the shot has it facing away from the camera, so the turn
  // that puts +Z along "away from the camera" is the one the capture was taken at. Read off the
  // camera rather than off the captured heading on purpose: the heading is the body's and can be a
  // few degrees from square to the shot, and what must be reproduced is the *picture*.
  const faceYaw = Math.atan2(-camera.x, -camera.z);
  return { camera, look, faceYaw };
}

/** The words the owner names an hour with, as a person would read them on a button. */
const HOUR_WORDS: Record<string, string> = {
  sunrise: 'Sunrise',
  sunriselater: 'After sunrise',
  earlymorning: 'Early morning',
  midmorning: 'Mid morning',
  morning: 'Morning',
  latemorning: 'Late morning',
  midday: 'Midday',
  earlyafternoon: 'Early afternoon',
  afternoon: 'Afternoon',
  afternoonlate: 'Late afternoon',
  lateafternoon: 'Late afternoon',
  eve: 'Evening',
  sunset: 'Sunset',
  sunsetbeautiful: 'Sunset',
  sunseticonic: 'Sunset',
  only: '',
};

/**
 * What to write on the button for one of a shot's hours, from the name the owner gave that capture
 * and the key of the shot it belongs to.
 *
 * The owner names these freely, so this reads what it knows and falls back on the hour itself
 * rather than printing a word nobody would recognise. An hour whose name says nothing at all (a
 * shot captured at one hour, named `only`) reads as the time on the clock, which is always true.
 */
export function hourLabel(name: string, key: string, hour: number): string {
  const h = Number.isFinite(hour) ? ((hour % 24) + 24) % 24 : 0;
  // Rounded to the minute as one number rather than hours and minutes apart: 19.65 hours is
  // 1178.9999 minutes in binary, so taking the hour and the fraction separately reads 19:38.
  const mins = Math.round(h * 60) % 1440;
  const clock = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  // What is left of the capture's name once the shot's own is off the front is the hour's word.
  // A capture whose name *is* the shot's has no such word at all, and reads as the time.
  const raw = name === key ? '' : name.startsWith(`${key}-`) ? name.slice(key.length + 1) : name;
  const word = HOUR_WORDS[raw.replace(/-/g, '').toLowerCase()];
  if (word) return word;
  // A capture named for nothing but being the only one reads as the time, which is always true.
  if (word === '' || !raw) return clock;
  // An unknown word is still the owner's own: it is shown tidied rather than replaced by a guess.
  const pretty = raw.replace(/-/g, ' ').trim();
  return `${pretty.charAt(0).toUpperCase()}${pretty.slice(1)}`;
}

/** Where a shot's picture for one hour lives, under the scenes folder. */
export function backdropPath(key: string, name: string): string {
  const hourPart = name.startsWith(`${key}-`) ? name.slice(key.length + 1) : name;
  return `${key}/${hourPart || 'only'}.jpg`;
}

/**
 * The three places the creator offers. The selection screen offers every shot; the creator is
 * deliberately a short list, which is the owner's own ask ("creation only show 3 places"), and
 * these three are the ones whose compositions carry a horizon, a town and a sky between them.
 * Changing this changes nothing else: it is a list of keys and every other screen ignores it.
 */
export const CREATOR_KEYS: readonly string[] = ['theed-overlook', 'lars-homestead', 'endor-treevillage'];

/** Whether a shot is one the creator offers, by its key. */
export function isCreatorShot(key: string): boolean {
  return CREATOR_KEYS.includes(key);
}
