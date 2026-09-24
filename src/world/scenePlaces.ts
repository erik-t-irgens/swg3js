// The places a character is shown in: where the camera stands, where the figure stands, and how
// the game's own orbiting camera is put back into one of them.
//
// These are the owner's captured shots (src/data/scenes.ts). The creation and selection screens
// stand the character in the **real world** at one of them: the sun of that hour really lights the
// figure, the animated surfaces really animate and the clouds really move, none of which a picture
// of the place could ever do. A rendered-backdrop version of this was built first and thrown away;
// what survived it is the arithmetic below, which is what the shots were always for.
//
// Everything here is pure, so a node test can sweep it rather than anybody eyeballing a seam.

import { PLANETS } from '../data/planets.ts';
/**
 * The world a pack belongs to, and the zone within it if it has zones.
 *
 * A capture records the **pack** it was taken in, which is what the world calls itself; travelling
 * wants a planet and a zone. For a one-zone world those are the same word, and for a many-zoned one
 * (Kashyyyk's seven) they are not, so the answer is looked up rather than assumed.
 */
export function packPlanet(pack: string): { planet: string; zone?: string } | null {
  for (const p of PLANETS) {
    if (!p.zones?.length) {
      if (p.id === pack) return { planet: p.id };
      continue;
    }
    const z = p.zones.find((x) => x.pack === pack);
    if (z) return { planet: p.id, zone: z.id };
  }
  return null;
}

/** A point, in whatever frame the thing holding it is in. */
export interface ScenePoint {
  x: number;
  y: number;
  z: number;
}

/**
 * How high over the feet the third-person camera's orbit is centred, standing.
 *
 * **This is not ours: it is `EYE_HEIGHT` in `src/core/camera.ts`**, restated here because this file
 * is pure and may not import the camera. A node test reads that file as text and fails if the two
 * ever disagree, the way the palette and the display's own geometry are kept in step.
 */
export const ORBIT_EYE_HEIGHT = 1.5;

/**
 * The three numbers that put the game's own orbiting camera back in a captured shot.
 *
 * The third-person camera stands at `focus + dir * distance` with
 * `dir = (sin yaw * cos pitch, sin pitch, cos yaw * cos pitch)`, so a captured camera offset
 * inverts straight into yaw, pitch and distance and reproduces the offset exactly (checked over
 * every capture to a part in 10^15). The **turn is the exact one**; the height and the distance
 * are close rather than exact in play, because the orbit hangs off the body's own focus point and
 * not off the feet the capture measured from. That is the right trade for what this is used for --
 * standing somebody back in a place so they can recognise it -- and the pictures themselves are
 * framed by the shoot, which uses the captured camera outright and none of this.
 */
export function orbitFor(shot: { stand: { x: number; y: number; z: number }; camera: { x: number; y: number; z: number } }, eyeHeight = ORBIT_EYE_HEIGHT): { yaw: number; pitch: number; distance: number } {
  const x = shot.camera.x - shot.stand.x;
  // **From the eyes, not the feet.** The orbit's centre is the body's view height above where it
  // stands, and measuring from the feet instead put the camera a metre and a half too high and
  // therefore looking that much further down -- about 23 degrees at these distances, and the same
  // amount at every shot, since they all stand the camera roughly 1.5 m up and 3.5 m back.
  const y = shot.camera.y - (shot.stand.y + eyeHeight);
  const z = shot.camera.z - shot.stand.z;
  const distance = Math.hypot(x, y, z) || 1;
  return { yaw: Math.atan2(x, z), pitch: Math.asin(Math.max(-1, Math.min(1, y / distance))), distance };
}

/**
 * Where a point in the world lands on the screen of a captured shot.
 *
 * `x` and `y` are fractions of the half-screen: 0 is dead centre and 1 is the edge, so anything
 * past 1 is cut off. `ahead` is false for something behind the camera, which is the one case where
 * the fractions mean nothing at all.
 *
 * This exists because a ship parked by eye can sit exactly on the frame's edge without anybody
 * noticing: it is drawn live in three dimensions rather than baked into the picture, so a window
 * narrower than the one it was judged in really does cut it in half.
 */
export function framePlace(
  camera: { x: number; y: number; z: number; look: ScenePoint; fov: number },
  point: ScenePoint,
  aspect: number,
): { ahead: boolean; x: number; y: number; inFrame: boolean; distance: number } {
  const f = { x: camera.look.x - camera.x, y: camera.look.y - camera.y, z: camera.look.z - camera.z };
  const fl = Math.hypot(f.x, f.y, f.z) || 1;
  f.x /= fl;
  f.y /= fl;
  f.z /= fl;
  // The camera's own right and up, taken against world up as three's `lookAt` does.
  let r = { x: -f.z, y: 0, z: f.x };
  const rl = Math.hypot(r.x, r.y, r.z) || 1;
  r = { x: r.x / rl, y: r.y / rl, z: r.z / rl };
  const u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x };
  const d = { x: point.x - camera.x, y: point.y - camera.y, z: point.z - camera.z };
  const ahead = d.x * f.x + d.y * f.y + d.z * f.z;
  const right = d.x * r.x + d.y * r.y + d.z * r.z;
  const up = d.x * u.x + d.y * u.y + d.z * u.z;
  const tv = Math.tan((Math.max(1e-3, Math.min(179, camera.fov)) * Math.PI) / 360);
  const th = tv * Math.max(1e-6, aspect);
  const x = ahead > 0 ? right / (ahead * th) : 0;
  const y = ahead > 0 ? up / (ahead * tv) : 0;
  return { ahead: ahead > 0, x, y, inFrame: ahead > 0 && Math.abs(x) <= 1 && Math.abs(y) <= 1, distance: Math.hypot(d.x, d.y, d.z) };
}

/** The narrowest window a scene is judged against: anything cut off here is cut off for most people. */
export const FRAME_ASPECT = 16 / 9;

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

/**
 * The three places the creator offers. The selection screen offers every shot; the creator is
 * deliberately a short list, which is the owner's own ask ("creation only show 3 places"), and
 * these three are the ones whose compositions carry a horizon, a town and a sky between them.
 * Changing this changes nothing else: it is a list of keys and every other screen ignores it.
 */
export const CREATOR_KEYS: readonly string[] = ['lars-homestead', 'theed-overlook', 'tyrena'];

/** Whether a shot is one the creator offers, by its key. */
export function isCreatorShot(key: string): boolean {
  return CREATOR_KEYS.includes(key);
}
