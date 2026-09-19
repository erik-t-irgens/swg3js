// Web Worker: renders a ship's paint off the main thread (a 1024² hull takes most of a second).
// Message in:  { id, recipe, values: [name, value][], palettes, dir }  (dir: the images' folder, an absolute URL)
// Messages out: { id, width, height, rgba, emis?: { width, height, rgba } }  (the buffers transferred)
//             | { id, empty: true }  (nothing rendered: an image missing)
//             | { id, error }
// It fetches only the images the recipe reads for the values (each choice at the value chosen), decodes
// them as they are (png.ts: no canvas, so no premultiplied alpha) and keeps them, least recently used
// let go first, up to 96 MB.
import type { Img } from '../player/texrender.ts';
import { decodePng } from '../player/png.ts';
import { ImageCache, paintFiles, runPaintJob, type PaintRecipe } from './paintJob.ts';

interface PaintMessage {
  id: number;
  recipe: PaintRecipe;
  values: [string, number][];
  palettes: Record<string, number[][]>;
  dir: string;
}

const ctx = self as unknown as { postMessage(message: unknown, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent) => void) | null };

const cache = new ImageCache(96 * 1024 * 1024);
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

ctx.onmessage = (e: MessageEvent<PaintMessage>) => {
  const { id, recipe, values, palettes, dir } = e.data;
  void (async () => {
    try {
      const vals = new Map(values);
      // This job's own images, held for its render whatever the cache lets go meanwhile.
      const mine = new Map<string, Img | null>();
      await Promise.all(paintFiles(recipe, vals).map(async (f) => mine.set(f, await image(`${dir}${f}`))));
      const img = runPaintJob(recipe, vals, palettes, (f) => (f ? (mine.get(f) ?? null) : null));
      if (!img) {
        ctx.postMessage({ id, empty: true });
        return;
      }
      // A render never hands back a cached image's own buffer, but a copy makes sure a transfer cannot empty the cache.
      const sources = new Set<ArrayBufferLike>([...mine.values()].filter((x): x is Img => !!x).map((x) => x.rgba.buffer));
      const own = (a: Img['rgba']): Uint8Array => (sources.has(a.buffer) ? new Uint8Array(a) : a instanceof Uint8Array ? a : new Uint8Array(a.buffer, a.byteOffset, a.length));
      const rgba = own(img.rgba);
      const emis = img.emis ? { width: img.emis.width, height: img.emis.height, rgba: own(img.emis.rgba) } : undefined;
      const transfer: Transferable[] = [rgba.buffer as ArrayBuffer];
      if (emis && emis.rgba.buffer !== rgba.buffer) transfer.push(emis.rgba.buffer as ArrayBuffer);
      ctx.postMessage({ id, width: img.width, height: img.height, rgba, ...(emis ? { emis } : {}) }, transfer);
    } catch (err) {
      ctx.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
    }
  })();
};
