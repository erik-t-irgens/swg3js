// Web Worker: renders customization recipes off the main thread, for whichever renderer made it
// (recipeWorker.ts: a ship's paint, a 1024² hull taking most of a second; a character's skin, hair and
// clothes, each of which used to stop the frame while it rendered). One worker per renderer, so a
// recolour never waits behind a hull.
// Message in:  { init: { cacheMB } }  (once, first: how much decoded image this worker keeps)
//            | { id, recipe, values: [name, value][], palettes, dir, normal }  (dir: the images' folder, an absolute URL)
// Messages out: { id, width, height, rgba, emis?: { width, height, rgba }, normal?: { width, height, rgba }, ms }  (the buffers transferred)
//             | { id, empty: true }  (nothing rendered: an image missing)
//             | { id, error }
// It fetches only the images the recipe reads for the values (each choice at the value chosen), decodes
// them as they are (png.ts: no canvas, so no premultiplied alpha) and keeps them, least recently used
// let go first, up to the size it was told. A character's job also makes the normal map the values pick.
import type { Img } from './texrender.ts';
import { decodePng } from './png.ts';
import { ImageCache, paintFiles, runRecipeJob, type PaintRecipe } from '../vehicles/paintJob.ts';

interface JobMessage {
  id: number;
  recipe: PaintRecipe;
  values: [string, number][];
  palettes: Record<string, number[][]>;
  dir: string;
  normal?: boolean;
}

const ctx = self as unknown as { postMessage(message: unknown, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent) => void) | null };

const MB = 1024 * 1024;
let cache = new ImageCache(96 * MB);
const loading = new Map<string, Promise<Img | null>>();

/** One image, fetched and decoded once (a failed one is remembered as missing). */
function image(url: string): Promise<Img | null> {
  const key = url.toLowerCase();
  const have = cache.get(key);
  if (have !== undefined) return Promise.resolve(have);
  let p = loading.get(key);
  if (!p) {
    p = fetch(url)
      .then(async (res) => (res.ok ? decodePng(new Uint8Array(await res.arrayBuffer())) : null))
      .catch(() => null)
      .then((img) => {
        cache.set(key, img);
        loading.delete(key);
        return img;
      });
    loading.set(key, p);
  }
  return p;
}

ctx.onmessage = (e: MessageEvent<JobMessage | { init: { cacheMB: number } }>) => {
  if ('init' in e.data) {
    const mb = Number(e.data.init?.cacheMB);
    if (Number.isFinite(mb) && mb > 0) cache = new ImageCache(mb * MB);
    return;
  }
  const { id, recipe, values, palettes, dir, normal } = e.data;
  void (async () => {
    try {
      const vals = new Map(values);
      // This job's own images, held for its render whatever the cache lets go meanwhile.
      const mine = new Map<string, Img | null>();
      await Promise.all(paintFiles(recipe, vals).map(async (f) => mine.set(f, await image(`${dir}${f}`))));
      const t0 = performance.now();
      const img = runRecipeJob(recipe, vals, palettes, (f) => (f ? (mine.get(f) ?? null) : null), !!normal);
      const ms = performance.now() - t0;
      if (!img) {
        ctx.postMessage({ id, empty: true });
        return;
      }
      // A render never hands back a cached image's own buffer, but a copy makes sure a transfer cannot empty the cache.
      const sources = new Set<ArrayBufferLike>([...mine.values()].filter((x): x is Img => !!x).map((x) => x.rgba.buffer));
      const own = (a: Img['rgba']): Uint8Array => (sources.has(a.buffer) ? new Uint8Array(a) : a instanceof Uint8Array ? a : new Uint8Array(a.buffer, a.byteOffset, a.length));
      const rgba = own(img.rgba);
      const emis = img.emis ? { width: img.emis.width, height: img.emis.height, rgba: own(img.emis.rgba) } : undefined;
      const nrm = img.normal ? { width: img.normal.width, height: img.normal.height, rgba: own(img.normal.rgba) } : undefined;
      const transfer = new Set<ArrayBuffer>([rgba.buffer as ArrayBuffer]);
      if (emis) transfer.add(emis.rgba.buffer as ArrayBuffer);
      if (nrm) transfer.add(nrm.rgba.buffer as ArrayBuffer);
      ctx.postMessage({ id, width: img.width, height: img.height, rgba, ms, ...(emis ? { emis } : {}), ...(nrm ? { normal: nrm } : {}) }, [...transfer]);
    } catch (err) {
      ctx.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
    }
  })();
};
