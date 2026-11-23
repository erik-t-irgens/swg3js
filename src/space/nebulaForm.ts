// How a space zone's nebulae are drawn on WebGPU, and where its volumes of gas stand (the GPU port's pass 2, wave 4b, maker C;
// the design's 2.9, "Volumes from volume.js ... only High starts on them; the viewer's High is never offered. The switch:
// Off, Sheets or Volumes"). Pure: no three, no page, so the node tests read the very rules the world and the drawing read.
//
// **The switch** (the Graphics page's Space row "Nebulae", `Settings.nebulaForm`): Off draws no cloud (the lightning still
// strikes, it is the game's rule); Sheets draws SWG's own glowing and misty sheets and the haze inside one; Volumes draws the
// sheets and, where the zone has one, its great cloud of gas as a true volume (`src/sky/look/volume.js`, the space body
// viewer's), marched at half the screen's resolution from its baked noise (the viewer's Medium, 40 steps, from High; its Low,
// 16, below), never the viewer's live High (13 to 47 ms). By the quality tier (its start): Sheets on Low and Medium, Volumes
// on High and Ultra and on a custom set (High's, as the bodies take it). Every way is built behind the zone's loading screen,
// so the row moves only what is shown.
//
// **Where a volume stands.** A volume is a look of the space body viewer's with a gas part, worn by a place of the zone: the
// owner's Save to game names it (`uses`), else the viewer's own start (`DEFAULT_VOLUMES`: the Maw's place wears the Maelstrom,
// as the viewer's lore entry adds it). A place the lore added (`new:<zone>:<name>`) stands where its lore entry starts it
// (`missing.js`'s `placement.start`: yaw, pitch, size across, distance); a place of SWG's zone where its planet hangs.
import { loreStart, skyDirection } from './loreStarts.js';
import { spacePlaceIds } from './spaceAir.ts';

/** The three ways of drawing a zone's nebulae. */
export type NebulaForm = 'off' | 'sheets' | 'volumes';

/** The row's values: -1 the tier's, 0 Off, 1 Sheets, 2 Volumes. */
export const NEBULA_FORM_VALUES = { tier: -1, off: 0, sheets: 1, volumes: 2 } as const;

/**
 * The form the row and the tier give (`tierIndex` as `tierIndexOf` answers it: 0 Low to 3 Ultra, -1 a custom set): the row's
 * own where it names one, else Sheets below High and Volumes from High (a custom set takes High's, the tier a new player
 * starts on).
 */
export function nebulaFormOf(setting: number, tierIndex: number): NebulaForm {
  if (setting === 0) return 'off';
  if (setting === 1) return 'sheets';
  if (setting === 2) return 'volumes';
  return tierIndex === 0 || tierIndex === 1 ? 'sheets' : 'volumes';
}

/** The volume tier of the viewer's a form draws at a quality tier: its Medium (40 baked steps) from High, its Low (16) below. */
export function volumeTierOf(tierIndex: number): 'medium' | 'low' {
  return tierIndex === 0 || tierIndex === 1 ? 'low' : 'medium';
}

/** The viewer's own starts: the places a lore entry adds with a volume ready for it (the viewer's `LORE_LOOKS`), by preset. */
export const DEFAULT_VOLUMES: Readonly<Record<string, string>> = { 'new:space_light1:the_maw': 'v-maelstrom' };

/** Where a volume stands: its place, its direction (the game's frame), its size across in degrees, its place's distance. */
export interface VolumePlace {
  place: string;
  /** The look the file names (its id), or the preset of the viewer's own start. */
  look: string;
  fromFile: boolean;
  dir: { x: number; y: number; z: number };
  sizeDeg: number;
  distance: number;
}

/** A zone's planet as the file has it: its appearance, its direction (the file's frame) and its size (radius over distance). */
export interface ZonePlanet {
  appearance: string;
  direction: readonly number[];
  size: number;
}

/** The game unit a pack's planet `size` is in (`SPACE_BODY_FRAME`: 240 m at 2600 m). */
export const SPACE_FRAME = { radius: 240, distance: 2600 };

/**
 * The zone's volumes: every place of the zone the owner's file gives a look with a gas part (`isVolume(id)`), and every place of
 * the viewer's own starts the file does not name, each where it stands. `uses` the file's place to look (or null: no file).
 */
export function volumePlacesOf(zone: string, planets: readonly ZonePlanet[], uses: Readonly<Record<string, string>> | null, isVolume: (lookId: string) => boolean): VolumePlace[] {
  const out: VolumePlace[] = [];
  const ids = spacePlaceIds(zone, planets.map((p) => p.appearance));
  const named = new Set<string>();
  const stand = (place: string, look: string, fromFile: boolean): void => {
    const lore = place.startsWith(`new:${zone}:`) ? loreStart(place) : null;
    if (lore) {
      out.push({ place, look, fromFile, dir: skyDirection(lore.yaw, lore.pitch), sizeDeg: lore.size, distance: lore.distance });
      return;
    }
    const i = ids.indexOf(place);
    if (i < 0) return;
    const p = planets[i];
    const d = p.direction;
    const len = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
    if (!(len > 0)) return;
    // The game's frame mirrored in X, as the world reads it; its angle across as the game sizes it.
    const share = Math.min(1, (p.size * SPACE_FRAME.radius) / SPACE_FRAME.distance);
    out.push({ place, look, fromFile, dir: { x: -d[0] / len, y: d[1] / len, z: d[2] / len }, sizeDeg: (2 * Math.asin(share) * 180) / Math.PI, distance: len });
  };
  if (uses) {
    for (const [place, id] of Object.entries(uses)) {
      if (!(place.startsWith(`${zone}:`) || place.startsWith(`new:${zone}:`))) continue;
      named.add(place);
      if (isVolume(id)) stand(place, id, true);
    }
  }
  for (const [place, preset] of Object.entries(DEFAULT_VOLUMES)) {
    if (named.has(place) || !place.startsWith(`new:${zone}:`)) continue;
    stand(place, preset, false);
  }
  return out;
}

/**
 * The viewer's stage distance for a place's distance (`placeview.js`' `spaceDrawDistance`): which body stands in front of which
 * in a zone is the viewer's, so a volume's gas ends at a planet where the viewer's does.
 */
export function stageDistance(d: number): number {
  const v = Math.max(1, d);
  return (8000 * v) / (v + 2000);
}

/**
 * Where a volume hangs in the game: `reach` metres out along its direction, its ball's radius covering its angle across (the
 * viewer's sphere rule, its half angle held under 89.4 degrees). Into `out`: x, y, z its middle less the eye, w its radius.
 */
export function volumeHang(v: VolumePlace, reach: number, out: { x: number; y: number; z: number; w: number }): typeof out {
  const half = Math.min((v.sizeDeg * Math.PI) / 360, Math.PI / 2 - 0.01);
  out.x = v.dir.x * reach;
  out.y = v.dir.y * reach;
  out.z = v.dir.z * reach;
  out.w = reach * Math.sin(half);
  return out;
}

/**
 * A planet of the zone as the gas sees it (an occluder of `volume.js`, its middle and radius in the volume scene's frame, the
 * eye at its origin): the viewer's stage, where the volume stands at its place's distance and the planet at its own, scaled so
 * the volume lands where the game hangs it (`reach`), so the angles of both are kept and the gas ends at a planet in front of
 * it exactly as in the viewer. `sinAng` the planet's angular radius's sine as the game draws it.
 */
export function occluderOf(v: VolumePlace, reach: number, planetDir: { x: number; y: number; z: number }, planetDistance: number, sinAng: number, out: { x: number; y: number; z: number; w: number }): typeof out {
  const k = reach / stageDistance(v.distance);
  const s = stageDistance(planetDistance) * k;
  out.x = planetDir.x * s;
  out.y = planetDir.y * s;
  out.z = planetDir.z * s;
  out.w = s * Math.min(0.9999, Math.max(0, sinAng));
  return out;
}

/**
 * The volumes' numbers (none of them feel: where the gas hangs and how big its half-resolution picture is):
 *   - **reach: 4000 m.** Past every planet's own sphere (hung at 2600 m) and inside the 9 km far plane with the widest ball (a
 *     half angle of 89.4 degrees reaches 8 km); the gas is scenery and its angle is what is seen, so its distance moves nothing
 *     but which ships and stations stand in front of it (a station nearer than 4 km does, as before the gas).
 *   - **scale: 0.5.** The design's half resolution of the scene's own size.
 */
export const VOLUME_FIXED = { reach: 4000, scale: 0.5 };
