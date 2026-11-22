// Where a world's night sky is seen from in the galaxy (the GPU port's pass 2, wave 3): its system's place on the galaxy map
// (`systemPlace`, the map's own layout, worked again when the map's numbers move), so the band is the map's disc seen from
// there and the stars are the system's own. Worlds of no system: Hoth's heroic at Hoth's canon square, K-18 (the star table
// already puts it under Hoth's sun, `stars.ts`'s `WORLD_SYSTEM`), and any other (the gallery, a world of the owner's own) a
// place of its own name's seed at the band's reference radius.
//
// Pure: no three, no DOM.
import { GALAXY_TUNE, systemOf, systemPlace, type GalaxySystemDef } from '../../data/galaxy.ts';
import { BAND_REFERENCE } from './galaxyDensity.ts';
import { seedOf } from './starCatalogue.ts';

/** Worlds of no galaxy system that a sky is placed for anyway: the system's key (its stars' seed) and its canon square. */
export const NIGHT_PLACES: Readonly<Record<string, { key: string; grid: string }>> = {
  adventure2: { key: 'hoth', grid: 'K-18' },
};

/** A world's night's place: the key its stars are seeded by, and how its place on the map is worked (as the map's numbers stand). */
export function nightPlaceOf(planetId: string): { key: string; placeOf: () => { x: number; y: number; z: number } } {
  const sys = systemOf(planetId);
  if (sys) return { key: sys.id, placeOf: () => systemPlace(sys) };
  const own = NIGHT_PLACES[planetId];
  if (own) {
    const def: GalaxySystemDef = { id: own.key, name: own.key, grid: own.grid, confidence: 'ours', zone: null, worlds: [] };
    return { key: own.key, placeOf: () => systemPlace(def) };
  }
  // A world of no system: a turn of its own about the middle at the reference radius, in the plane.
  const a = (seedOf(`place:${planetId}`) / 4294967296) * Math.PI * 2;
  return { key: `world:${planetId}`, placeOf: () => ({ x: Math.cos(a) * BAND_REFERENCE.r * (GALAXY_TUNE.discRadius / 1900), y: 0, z: Math.sin(a) * BAND_REFERENCE.r * (GALAXY_TUNE.discRadius / 1900) }) };
}
