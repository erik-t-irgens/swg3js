// A ground sky's places he moved or sized on the space body viewer's Place tab, in the game (the GPU port's pass 2, wave 6,
// maker K; waves 4b and 5 carried a space place's alone, and a ground place's size or direction never reached the game). Save
// to game writes each of SWG's slots' and celestials' own numbers he set (`viewer/gameBodies.mjs`' `groundPlacesForGame`):
// the size, as the Place tab shows it (degrees across the square SWG draws, `2 atan(size / 3)`), and for a celestial, a second
// sun and a second moon the yaw and pitch (a celestial's place in the sky, a second body's offset from the light, as SWG's file
// has them). The game reads them at a loading screen (`bodiesFile.ts`' `places`) and lays them over SWG's sky file before the
// sky is made (`World.loadSky`, through `SwgSky.load`'s own hook for a sky made of parts), so the cards, the looks they wear
// and the motion's places all start from his numbers; a glow keeps its share of its disc. A place with none keeps SWG's. Under
// an applied star system the system still places and sizes the bodies it names (the viewer draws it so too).
//
// WebGPU's alone, as the file is (`World.loadSky`). Pure but for reading the file as read: the node test runs it.
import type { SkyData } from '../../world/sky.ts';
import { SKY_BODIES } from './bodiesFile.ts';
import { pictureNameOf } from '../system/skyMotion.ts';

const DEG = Math.PI / 180;

/** What the last loading screen laid, for the console (`__debug.sky({ bodies: true })`'s `groundPlaces`): the world and each place's numbers. */
export const GROUND_PLACES_LAID: { world: string; places: Record<string, { yaw?: number; pitch?: number; sizeDeg?: number; size?: number }> } = { world: '', places: {} };

/** A square's degrees across (the Place tab's size) as SWG's size: the inverse of `2 atan(size / 3)`. */
export function sizeOfDegrees(deg: number): number {
  const d = deg < 0.01 ? 0.01 : deg > 179 ? 179 : deg;
  return 3 * Math.tan((d * DEG) / 2);
}

/** One place's numbers from the file (the reader's ranges held already), or null. */
type GroundEdit = { yaw?: number; pitch?: number; size?: number };

/**
 * The file's ground places of `world` laid over its sky's data, or null where the file names none of them (the sky as SWG's
 * file has it, to the byte). `edits` is the file's `places` (the read file's by default).
 */
export function groundPlacesMix(world: string, edits: Record<string, GroundEdit> | null | undefined = SKY_BODIES.file?.places): ((d: SkyData) => SkyData) | null {
  GROUND_PLACES_LAID.world = world;
  GROUND_PLACES_LAID.places = {};
  if (!edits) return null;
  const prefix = `${world}:`;
  const mine = Object.keys(edits).filter((id) => id.startsWith(prefix) && !id.startsWith('space_'));
  if (!mine.length) return null;
  return (d: SkyData): SkyData => {
    const out: SkyData = { ...d, celestials: d.celestials.map((c) => ({ ...c })) };
    const lay = (c: { size: number; glowSize: number; yaw?: number; pitch?: number } | null, id: string, turns: boolean): typeof c => {
      const e = edits[id];
      if (!c || !e) return c;
      const o = { ...c };
      if (typeof e.size === 'number') {
        const size = sizeOfDegrees(e.size);
        // A glow keeps its share of its disc.
        if (o.size > 0) o.glowSize = (o.glowSize * size) / o.size;
        o.size = size;
      }
      if (turns && typeof e.yaw === 'number') o.yaw = e.yaw;
      if (turns && typeof e.pitch === 'number') o.pitch = e.pitch;
      GROUND_PLACES_LAID.places[id] = { yaw: o.yaw, pitch: o.pitch, size: o.size, sizeDeg: (2 * Math.atan(o.size / 3)) / DEG };
      return o;
    };
    out.sun = lay(d.sun, `${world}:sun`, false) as SkyData['sun'];
    out.supplementalSun = lay(d.supplementalSun, `${world}:sun2`, true) as SkyData['supplementalSun'];
    out.moon = lay(d.moon, `${world}:moon`, false) as SkyData['moon'];
    out.supplementalMoon = lay(d.supplementalMoon, `${world}:moon2`, true) as SkyData['supplementalMoon'];
    // A celestial by its picture's name, `#n` where the picture repeats (`skyMotion.ts`' `skyPlacesOf`, the viewer's ids).
    const counts: Record<string, number> = {};
    out.celestials = out.celestials.map((c) => {
      const name = pictureNameOf(c.image?.file) ?? 'unnamed';
      counts[name] = (counts[name] ?? 0) + 1;
      return lay(c, `${world}:celestial:${name}${counts[name] > 1 ? '#' + counts[name] : ''}`, true) as typeof c;
    });
    return out;
  };
}
