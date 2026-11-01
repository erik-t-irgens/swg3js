// A world's own map picture, fetched once per pack for the session and shared by everything that shows
// it: the map window, the minimap, the galaxy map's thumbnails and the travel terminal. There were
// three loaders of the same two files before this, each with a cache of its own, so a world looked at in
// the map window and then on a terminal fetched and decoded its picture twice.
//
// A pack's `map.json` names its picture and the ground the picture covers (`mapFrame`); the picture is
// the client's own `texture/ui_map_<planet>.dds`, converted by the `maps` command, and it is the map
// window's art and not the interface's, which the rules allow. It is decoded once, off the main thread
// where the browser can, with `createImageBitmap`, and the decoded picture is what every canvas draws.
// A page that only wants to put it in an `<img>` takes the address instead and decodes nothing here.
//
// Every answer is a promise kept per pack, so asking twice costs nothing, and a pack with no picture
// answers null and is never fetched again this session: a space zone, the dungeon copies and a world
// with no pack are never asked at all (`packFiles.ts`), and a pack converted before the `maps` command
// is asked once.

import { mapFrame, type MapFrame } from './spaceMapLayers.ts';
import { packJson } from '../world/packFiles.ts';

/** A picture's address and the ground it covers, in the map's own frame (the snapshot's). */
export interface MapMeta {
  url: string;
  frame: MapFrame;
  /**
   * A zone of copies' own pictures (`instanceFramesOf` in tools/swg/mapframe.mjs): each copy's box in the map's frame,
   * the picture drawn over it and the ground that picture covers. Absent on every other world.
   */
  instances?: { box: [number, number, number, number]; url: string; frame: MapFrame }[];
}

/** A picture decoded for a canvas, and the ground it covers. */
export interface MapPicture {
  image: ImageBitmap;
  frame: MapFrame;
}

const metas = new Map<string, Promise<MapMeta | null>>();
/** The metas that have answered, by pack, so a frame can ask which copy a point stands in without waiting. */
const metasReady = new Map<string, MapMeta | null>();
const pictures = new Map<string, Promise<MapPicture | null>>();
/** The pictures that have arrived, by pack, so a frame can ask for one without waiting on anything. */
const ready = new Map<string, MapPicture | null>();
/** A zone of copies' pictures, by pack and copy, once each has arrived (undefined while on its way). */
const readyCopies = new Map<string, (MapPicture | null | undefined)[]>();
/** The decoded pictures by address: a zone's copies share a picture of each kind, decoded once. */
const bitmaps = new Map<string, Promise<ImageBitmap | null>>();

/** Where the packs are served from: the page's own base, which the builder rewrites. */
function base(): string {
  const env = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
  return env?.BASE_URL ?? '/';
}

/** A pack's picture address and the ground it covers, or null where none is converted. */
export function mapMeta(packId: string): Promise<MapMeta | null> {
  let p = metas.get(packId);
  if (!p) {
    const dir = `${base()}assets-private/${packId}/`;
    // Asked only of a pack the `maps` command writes a picture for (`packHolds`: a ground world with a pack, not the
    // copies' world nor a space zone, which every map window and minimap there used to ask for once and miss). Never
    // behind the manifest's probe: the galaxy tab and a travel terminal ask for a far world's picture, whose manifest
    // (up to 2.8 MB) nothing has fetched yet and the arrival would fetch again; the file's own 404 is remembered instead.
    p = packJson<{ image?: string; width?: number; centre?: { x: number; z: number }; instances?: { box?: number[]; image?: string; width?: number; centre?: { x: number; z: number } }[] }>(packId, 'map.json', base(), { probe: false })
      .then((meta) => {
        if (!meta?.image) return null;
        const out: MapMeta = { url: `${dir}${meta.image}`, frame: mapFrame(meta) };
        const copies = (meta.instances ?? []).filter((c) => Array.isArray(c?.box) && c.box.length === 4 && c.box.every(Number.isFinite) && typeof c.image === 'string');
        if (copies.length) out.instances = copies.map((c) => ({ box: [c.box![0], c.box![1], c.box![2], c.box![3]], url: `${dir}${c.image}`, frame: mapFrame(c) }));
        return out;
      })
      .catch(() => null)
      .then((meta) => {
        metasReady.set(packId, meta);
        return meta;
      });
    metas.set(packId, p);
  }
  return p;
}

/**
 * Which copy of a zone of copies a point of the map's frame stands in (the smallest box holding it), or -1: on every
 * other world, outside every copy, and while the pack's map.json is still on its way (the first ask starts it).
 * Allocates nothing once the meta is in, so a frame may ask.
 */
export function mapCopyAt(packId: string, mapX: number, mapZ: number): number {
  const meta = metasReady.get(packId);
  if (meta === undefined) {
    void mapMeta(packId);
    return -1;
  }
  const list = meta?.instances;
  if (!list) return -1;
  let best = -1;
  let bestSize = Infinity;
  for (let i = 0; i < list.length; i++) {
    const b = list[i].box;
    if (mapX < b[0] || mapX > b[2] || mapZ < b[1] || mapZ > b[3]) continue;
    const size = (b[2] - b[0]) * (b[3] - b[1]);
    if (size < bestSize) {
      bestSize = size;
      best = i;
    }
  }
  return best;
}

/** A picture's bitmap, decoded once by its address for every copy that wears it. */
function bitmapOf(url: string): Promise<ImageBitmap | null> {
  let p = bitmaps.get(url);
  if (!p) {
    p = fetch(url)
      .then(async (res) => (res.ok ? createImageBitmap(await res.blob()) : null))
      .catch(() => null);
    bitmaps.set(url, p);
  }
  return p;
}

/** A zone of copies' pictures asked for and not yet in, by pack and copy, so a frame asking again starts nothing. */
const copyAsks = new Map<string, Map<number, Promise<MapPicture | null>>>();

/** One copy's picture of a zone of copies, decoded for a canvas, with the ground that copy's picture covers; null where it has none. */
export function mapCopyPicture(packId: string, which: number): Promise<MapPicture | null> {
  let asks = copyAsks.get(packId);
  if (!asks) copyAsks.set(packId, (asks = new Map()));
  let p = asks.get(which);
  if (!p) {
    p = (async () => {
      const meta = await mapMeta(packId);
      const c = meta?.instances?.[which];
      const image = c ? await bitmapOf(c.url) : null;
      const pic = c && image ? { image, frame: c.frame } : null;
      let list = readyCopies.get(packId);
      if (!list) readyCopies.set(packId, (list = []));
      list[which] = pic;
      return pic;
    })();
    asks.set(which, p);
  }
  return p;
}

/** A pack's picture decoded for a canvas, or null where none is converted or it would not decode. */
export function mapPicture(packId: string): Promise<MapPicture | null> {
  let p = pictures.get(packId);
  if (!p) {
    p = mapMeta(packId)
      .then(async (meta) => {
        if (!meta) return null;
        const res = await fetch(meta.url);
        if (!res.ok) return null;
        const image = await createImageBitmap(await res.blob());
        return { image, frame: meta.frame };
      })
      .catch(() => null)
      .then((pic) => {
        ready.set(packId, pic);
        return pic;
      });
    pictures.set(packId, p);
  }
  return p;
}

/**
 * A pack's picture if it has already arrived: the picture, null for a pack that has none, and undefined
 * while it is still on its way -- the first ask starts it. For a frame that must not wait on anything.
 *
 * With a point of the map's frame, a zone of copies answers with the picture of the copy that point stands in
 * (`mapCopyAt`), framed over that copy, and its own picture outside every copy.
 */
export function mapPictureNow(packId: string, mapX?: number, mapZ?: number): MapPicture | null | undefined {
  const which = mapX === undefined || mapZ === undefined ? -1 : mapCopyAt(packId, mapX, mapZ);
  if (which >= 0) {
    const got = readyCopies.get(packId)?.[which];
    if (got !== undefined) return got;
    void mapCopyPicture(packId, which);
    return undefined;
  }
  if (ready.has(packId)) return ready.get(packId);
  void mapPicture(packId);
  return undefined;
}
