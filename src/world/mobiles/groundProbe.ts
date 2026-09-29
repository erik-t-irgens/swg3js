// The ground under a body far out in the open, read where the world already holds it and never made on
// the spot (commit 4b of the frame-time wave).
//
// A creature or a person asks the terrain for its height every fourth frame when it is not near, and
// four times a second the manager asks again whether it has sunk under the ground. Near the player the
// answer is always held -- the chunks within the physics' reach are built and their blocks cached -- but a
// town's people left behind by a shuttle or a fast flight stand kilometres off, where the terrain cache has
// long let their blocks go, and `heightAt` there generates a whole block on the main thread to answer: 17
// such calls a frame at about 1.5 ms each were measured at 120 m/s, a quarter of every frame. Past the
// physics' reach there is no heightfield to stand on anyway, so nothing there needs an exact answer this
// frame: the world's cached reader (`World.groundIfCached`: a built block, else a far tile's coarse
// samples) answers, and where it holds nothing the answer is unknown and the body changes nothing.
//
// Inside that reach, and with the switch off (`FAR_PROBE.cached` false), the terrain answers as it
// always did. Pure, so a node test counts the calls (`farProbe.test.ts`).

/** The switch. False asks the terrain everywhere, as before. */
export const FAR_PROBE = { cached: true };

/** How each read was answered since the session began, for the console (`__debug.farTiles()`): counted, never made. */
export const FAR_PROBE_STATS = { terrain: 0, cached: 0, unknown: 0 };

/** What a body asks of the terrain. */
export interface ProbeTerrain {
  heightAt(x: number, z: number): number;
}

/** What it asks of the world instead, when the world can answer; none wired is the old behaviour. */
export interface ProbeWorld {
  /** The ground's height where the world already holds it, or null. */
  groundIfCached?(x: number, z: number): number | null;
  /** Whether the ground under a point is within the physics' reach, where the terrain's answer is always held. */
  groundSolid?(x: number, z: number): boolean;
}

/**
 * The ground's height under a body outdoors at (x, z), or null when it is far from the player and the
 * world holds nothing there: unknown, and the caller changes nothing it would have decided from it.
 */
export function groundUnder(x: number, z: number, terrain: ProbeTerrain, world: ProbeWorld, tune: { cached: boolean } = FAR_PROBE): number | null {
  if (!tune.cached || !world.groundIfCached || !world.groundSolid || world.groundSolid(x, z)) {
    FAR_PROBE_STATS.terrain++;
    return terrain.heightAt(x, z);
  }
  const h = world.groundIfCached(x, z);
  if (h === null) FAR_PROBE_STATS.unknown++;
  else FAR_PROBE_STATS.cached++;
  return h;
}

/**
 * Whether a body outdoors is standing, as `checkGround` decides it: on something the physics found, held
 * in a room with no floor, or no higher than a quarter of a metre over the ground -- and with the ground
 * unknown, as it was.
 */
export function standingOn(was: boolean, hit: boolean, airless: boolean, inside: boolean, y: number, ground: number | null): boolean {
  if (hit || airless) return true;
  if (inside) return false;
  return ground === null ? was : y <= ground + 0.25;
}
