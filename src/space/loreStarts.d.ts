// Types for `loreStarts.js` (the GPU port's pass 2, wave 4b, maker C): the viewer's lore entries' starts and sky directions.

/** A lore entry's start (`missing.js`' `placement.start`), by its place id, or null. */
export function loreStart(place: string): { yaw: number; pitch: number; size: number; distance: number } | null;
/** A sky direction from yaw and pitch in degrees (`places.js`' `skyDirection`, the game's frame). */
export function skyDirection(yawDeg: number, pitchDeg: number): { x: number; y: number; z: number };
