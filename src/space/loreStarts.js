// The space body viewer's lore entries' starting places and its sky's directions, for the game's TypeScript (the GPU port's
// pass 2, wave 4b, maker C: `nebulaForm.ts`, which hangs a volume where the viewer stands its place). The viewer's modules are
// its own JavaScript with no types of theirs; this reads them as they stand and answers in the shape `loreStarts.d.ts` gives.
// Pure: no three, no page.
import { MISSING } from '../sky/look/missing.js';
import { skyDirection as placesSkyDirection } from '../sky/system/places.js';

/** A lore entry's start (`placement.start`: yaw, pitch, size across in degrees, distance), by its place id, or null. */
export function loreStart(place) {
  for (const e of MISSING) {
    if (e.id !== place) continue;
    const s = e.placement && e.placement.start;
    if (!s || !Number.isFinite(s.yaw) || !Number.isFinite(s.pitch) || !Number.isFinite(s.size)) return null;
    return { yaw: s.yaw, pitch: s.pitch, size: s.size, distance: Number.isFinite(s.distance) ? s.distance : 2600 };
  }
  return null;
}

/** A sky direction from yaw and pitch in degrees (the viewer's `places.js`: yaw 0 toward -Z, 90 toward +X, the game's frame). */
export function skyDirection(yawDeg, pitchDeg) {
  return placesSkyDirection(yawDeg, pitchDeg);
}
