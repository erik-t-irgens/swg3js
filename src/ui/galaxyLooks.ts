// The galaxy map's globes in his looks (the GPU port's pass 2, wave 4b, maker C; the design's section 3, way 1: "share the bake,
// not the renderer"): each system's globe wears its main world's look as the game's card baked it behind a loading screen, read
// back as bytes (`GpuLooks.baked`, never a bake in play) and laid on the map window's own WebGL renderer, with a turning cloud
// shell and a painted rim from its world's air; SWG's space picture where no look is baked, and on WebGL as before.
//
// Pure apart from the runtime's read-back (`GPU.rt.looks.baked`, null on WebGL): no three, no page, so the node tests read the
// rules the map and the world read.
import { GPU } from '../core/gpuSwitch.ts';
import { SKY_BODIES, type BodyLook } from '../sky/look/bodiesFile.ts';
import { lookOfPlace, toneLayer } from '../sky/look/lookPictures.ts';
import { bodyRecord } from '../sky/bodies/bodyAir.ts';
import { appearanceName, lookRecordOf, rimProfile, spaceBodyAir, spacePlaceIds } from '../space/spaceAir.ts';

/**
 * The globes' numbers (feel is the owner's; each start's reason beside it):
 *   - **size: 512.** The picture a globe wears, texels across (a 1024 bake halved): a globe stands a few pixels to a couple of
 *     hundred across on the map, and twelve systems at 512 by 256 with their clouds and their mips are some 17 MB, the design's
 *     "about 14 MB" for the disc.
 *   - **cloudSpin: 0.03.** Radians a second the cloud shell turns over its globe: a slow drift that reads as weather moving on
 *     a world seen from far off, a turn in three and a half minutes.
 *   - **cloudHeight: 1.012.** The shell's radius over the globe's: clear of the surface at the map's nearest zoom.
 *   - **rimHeight: 1.06.** The painted rim's reach over the globe's radius. A world's air is under two percent of its radius,
 *     which on a globe a few pixels across is under a pixel; the rim keeps its own colour and fall-off over a reach that reads.
 *   - **rimStrength: 3.** The limb's own light is about a tenth of the light on it; three times reads as a thin glow on the lit
 *     limb under the map's light (2.2), as a painted rim does in the space body viewer.
 */
export const GLOBE_TUNE = { size: 512, cloudSpin: 0.03, cloudHeight: 1.012, rimHeight: 1.06, rimStrength: 3 };

/** The bake size asked of the looks (`LOOK_SIZES`' least): the globe's picture is it halved. */
export const GLOBE_BAKE = 1024;

/** A zone's planet's row the map's globe stands for (`planetTextureOf`'s rule: the first key named, else the largest not a moon). */
export function globePlanetIndex(planets: readonly { appearance: string; texture?: string | null; size?: number }[], keys: readonly string[]): number {
  for (const key of keys) {
    const want = `planet_${key.toLowerCase()}`;
    const i = planets.findIndex((p) => appearanceName(p.appearance) === want && !!p.texture);
    if (i >= 0) return i;
  }
  let best = -1;
  let bestSize = -1;
  for (let i = 0; i < planets.length; i++) {
    const p = planets[i];
    if (!p.texture || appearanceName(p.appearance).includes('_moon')) continue;
    if ((p.size ?? 0) > bestSize) {
      best = i;
      bestSize = p.size ?? 0;
    }
  }
  return best;
}

/** The place a system's globe stands for (its zone's main planet, the viewer's id), or null. */
export function globePlaceOf(zone: string, planets: readonly { appearance: string; texture?: string | null; size?: number }[], keys: readonly string[]): string | null {
  const i = globePlanetIndex(planets, keys);
  if (i < 0) return null;
  return spacePlaceIds(zone, planets.map((p) => p.appearance))[i] ?? null;
}

/** A globe's pictures: the surface (sRGB with the shine in alpha) and the clouds (brightness, cover in alpha), RGBA8, row 0 south. */
export interface GlobePictures {
  place: string;
  look: string;
  width: number;
  height: number;
  surface: Uint8Array;
  clouds: Uint8Array | null;
}

/** A picture halved each way by its 2-by-2 means (RGBA8, wrapping nothing: the widths are even). */
export function halve(px: Uint8Array, w: number, h: number): Uint8Array {
  const W = w >> 1;
  const H = h >> 1;
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = ((2 * y) * w + 2 * x) * 4;
      const b = a + 4;
      const c = a + w * 4;
      const d = c + 4;
      const o = (y * W + x) * 4;
      for (let k = 0; k < 4; k++) out[o + k] = (px[a + k] + px[b + k] + px[c + k] + px[d + k] + 2) >> 2;
    }
  }
  return out;
}

/**
 * The look a globe's place wears and its pictures as this session's bakes already hold them (`GpuLooks.baked`: never a bake),
 * halved to the globe's size; null on WebGL, with no file, where the place wears no generated look, or where its bake waits
 * for a loading screen (SWG's picture stays).
 */
export function globePictures(place: string): GlobePictures | null {
  if (!GPU.webgpu || !GPU.rt) return null;
  const hit = lookOfPlace(place);
  if (!hit) return null;
  // The globe's own halved pictures, made behind the screen that baked them (the fixer of pass 2, wave 4b), for the look it wears.
  const kept = GLOBES_HAD.get(place);
  if (kept && kept.look === hit.id && kept.key === globeKeyOf(hit.look)) return kept.pics;
  const pics = GPU.rt.looks.baked(hit.look, GLOBE_BAKE);
  if (!pics) return null;
  return halvedGlobe(place, hit.id, pics);
}

/**
 * The map's globes as they will wear them (the fixer of pass 2, wave 4b): each place's look halved to `GLOBE_TUNE.size` behind
 * the screen that baked it, by the place, so the bake's own pictures (4 MB a system at 1024 with clouds) are let go and the map
 * keeps 1 MB a system, and nothing is halved in play. A look changed or the size dial moved is halved again at the next screen.
 */
const GLOBES_HAD = new Map<string, { look: string; key: string; pics: GlobePictures }>();
const globeKeyOf = (look: BodyLook): string => `${JSON.stringify(look.generated ?? null)}@${GLOBE_TUNE.size}`;

function halvedGlobe(place: string, look: string, pics: { width: number; height: number; surface: Uint8Array; clouds: Uint8Array | null }): GlobePictures {
  let w = pics.width;
  let h = pics.height;
  let surface = pics.surface;
  let clouds = pics.clouds;
  while (w > GLOBE_TUNE.size && w % 2 === 0 && h % 2 === 0) {
    surface = halve(surface, w, h);
    if (clouds) clouds = halve(clouds, w, h);
    w >>= 1;
    h >>= 1;
  }
  return { place, look, width: w, height: h, surface, clouds };
}

/**
 * A globe's painted rim's table (`spaceAir.ts`' `rimProfile`): its world's own record where the place is a ground world's, else
 * its look's air or the start for its kind; null for a body with no air (a moon). A few milliseconds once a record.
 */
export function globeRim(place: string, appearance: string): Float32Array | null {
  const air = spaceBodyAir(appearance);
  const look: BodyLook | null = lookOfPlace(place)?.look ?? null;
  const lookAir = (look?.air ?? null) as Record<string, unknown> | null;
  const rec = air.kind === 'world' ? bodyRecord(air) : lookRecordOf(air, lookAir);
  return rec ? rimProfile(rec) : null;
}

/**
 * The space planets' places the owner's Save to game gives a look (each zone's main worlds and giants: no `#n`), for the world to
 * bake behind its loading screens so the map's globes can wear them; none with no file.
 */
export function mapLookPlaces(): string[] {
  const f = SKY_BODIES.file;
  if (!f) return [];
  return Object.keys(f.uses).filter((p) => /^space_[a-z0-9_]+:planet_[a-z0-9_]+$/.test(p) && !!lookOfPlace(p));
}

/** What the map's bakes did at the last screen (the console's and the prover's). */
export const MAP_LOOKS = { places: 0, had: 0, putOff: 0, at: '' };

/**
 * Behind a loading screen on WebGPU, after the screen's own bakes (the sky's bodies, the space planets): every globe's look baked
 * at `GLOBE_BAKE` (or read from the browser's storage) within what the screen's budget leaves, so the map wears them at its next
 * show; a look put off bakes at the next screen. `stale` answers whether the screen's load has been left. Never in a frame.
 */
export async function bakeMapLooks(stale: () => boolean): Promise<boolean> {
  const looks = GPU.rt?.looks;
  const places = mapLookPlaces();
  MAP_LOOKS.places = places.length;
  MAP_LOOKS.had = 0;
  MAP_LOOKS.putOff = 0;
  MAP_LOOKS.at = new Date().toISOString();
  if (!looks) return !stale();
  // The map's own budget, after the screen's bakes (the fixer of pass 2, wave 4b): its bakes never take what the sky's bodies and
  // the space planets had, and at most the bake cache's budget more of the screen.
  looks.beginScreen();
  for (const place of places) {
    const hit = lookOfPlace(place);
    if (!hit) continue;
    // A globe already halved for the look it wears is kept as it is: nothing read, nothing baked.
    const kept = GLOBES_HAD.get(place);
    const key = globeKeyOf(hit.look);
    if (kept && kept.look === hit.id && kept.key === key) {
      MAP_LOOKS.had++;
      continue;
    }
    const pics = await looks.bake(hit.id, hit.look, GLOBE_BAKE);
    if (pics) {
      MAP_LOOKS.had++;
      // Halved, then toned as the look's layers tone it (the sky's discs' and the space planets' rule; the halving made new
      // pictures, so the bake's own are untouched).
      const globe = halvedGlobe(place, hit.id, pics);
      if (globe.surface !== pics.surface) toneLayer(globe.surface, hit.look, 'surface');
      if (globe.clouds && globe.clouds !== pics.clouds) toneLayer(globe.clouds, hit.look, 'clouds');
      GLOBES_HAD.set(place, { look: hit.id, key, pics: globe });
      looks.release(hit.look, GLOBE_BAKE);
    } else MAP_LOOKS.putOff++;
    if (stale()) return false;
  }
  return !stale();
}
