// Whether a tactical goal can be stood on and walked to, asked before a body picks it (the AI handoff's step 3).
//
// A body's own feet are decided in two places that are not the brain: a place on the standoff ring a gunner holds
// while it shoots, and a cover spot. Both were picked first and walked into after -- a place on the ring through a
// building's wall, a spot in the next room -- and with the route asked only outside the attack state nothing planned
// the walk either. The route is asked in every state now; this is the other half, so that a goal that fails is never
// picked at all. Indoors the goal must stand on the room's own floor, which the client authored for every room
// (`worldNav.fits`); outdoors the straight leg to it must be walkable on the baked grid at the body's own width
// (`outdoorNav.legFits`). Where neither has anything to say -- a room with no floor, a world with no grid -- the
// answer is yes, and the goal is taken exactly as it always was.
//
// One function for the fighters and for the people from the catalogue, so the two cannot come to answer differently.
import type { CellState } from '../layoutStream.ts';
import { worldNav } from './nav.ts';
import { outdoorNav } from './outdoorNav.ts';

/**
 * Whether a body followed in `here` (null outdoors), standing at (x, y, z) with its own `radius`, may take (gx, gz) as
 * a tactical goal: on the room's floor indoors, a walkable leg outdoors.
 */
export function walkGoalFits(here: CellState | null, x: number, y: number, z: number, gx: number, gz: number, radius: number): boolean {
  if (here) return worldNav.fits(here, gx, y, gz, radius);
  return outdoorNav.legFits(x, z, gx, gz, radius);
}
