// A mobile standing in a room whose floor is not there just now, and the gravity a mobile takes.
//
// A building's colliders are built only near the player and taken away again past that, while the
// room a mobile is in goes on answering from the model's own data. So a body left in a building the
// player has walked away from is standing on a floor that is no longer there, and without a hold it
// falls through the building and out of the world. While its room has no collision it keeps the
// height it had, as the fighters do (`cellSolid`), and stands on its own floor again the moment the
// colliders come back. Which room that is and whether it is solid is the manager's to ask
// (`MobileManagerDeps.cellSolid`); this file is only what the body does about it.
//
// Pure of three and of the world: the body is the four calls it uses, so a node test hands it a real
// rapier body and watches it hold.

/** As much of a rapier body as holding it up takes. */
export interface AirBody {
  linvel(): { x: number; y: number; z: number };
  setLinvel(v: { x: number; y: number; z: number }, wake: boolean): void;
  gravityScale(): number;
  setGravityScale(scale: number, wake: boolean): void;
}

/**
 * No fall and no gravity: the height it has is the height it keeps. Called on every frame the room
 * is airless, after everything else that writes a velocity, so nothing done that frame starts a fall;
 * it writes only what differs, so a body already held costs two reads.
 */
export function holdAir(body: AirBody): void {
  const v = body.linvel();
  if (v.y !== 0) body.setLinvel({ x: v.x, y: 0, z: v.z }, true);
  if (body.gravityScale() !== 0) body.setGravityScale(0, true);
}

/**
 * The gravity a body of this browser's own takes: none while it holds its height in a room with no
 * floor, none for a swimmer, who is held at the surface, and none for a flyer while it lives. **A
 * dead flyer falls**: `die` gives it gravity for exactly that reason, and a floor coming back under
 * a flyer that died while its room had none must not hang the corpse in the air again.
 */
export function gravityFor(airless: boolean, swimming: boolean, flyer: boolean, dead: boolean): number {
  return airless || swimming || (flyer && !dead) ? 0 : 1;
}
