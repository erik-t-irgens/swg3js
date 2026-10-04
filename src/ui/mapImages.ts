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
// (a space zone, the dungeon copies, a pack converted before the `maps` command) answers null once and
// is never fetched again this session.

import { mapFrame, type MapFrame } from './spaceMapLayers.ts';

/** A picture's address and the ground it covers, in the map's own frame (the snapshot's). */
export interface MapMeta {
  url: string;
  frame: MapFrame;
}

/** A picture decoded for a canvas, and the ground it covers. */
export interface MapPicture {
  image: ImageBitmap;
  frame: MapFrame;
}

const metas = new Map<string, Promise<MapMeta | null>>();
const pictures = new Map<string, Promise<MapPicture | null>>();
/** The pictures that have arrived, by pack, so a frame can ask for one without waiting on anything. */
const ready = new Map<string, MapPicture | null>();

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
    p = fetch(`${dir}map.json`)
      .then(async (res) => {
        if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
        const meta = (await res.json()) as { image?: string; width?: number; centre?: { x: number; z: number } };
        return meta.image ? { url: `${dir}${meta.image}`, frame: mapFrame(meta) } : null;
      })
      .catch(() => null);
    metas.set(packId, p);
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
 */
export function mapPictureNow(packId: string): MapPicture | null | undefined {
  if (ready.has(packId)) return ready.get(packId);
  void mapPicture(packId);
  return undefined;
}
