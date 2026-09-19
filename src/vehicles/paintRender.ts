// Paint renders off the main thread: the recipe renderer a ship's paint gives its customizer. One
// module worker (paintWorker.ts), made the first time a ship is painted; the main thread only posts a
// job and, when the answer lands, puts the texture on (the customizer's `put`, one upload). Where a
// module worker cannot be had, the same render runs here between frames, with a warning once: each
// then costs this thread its whole render (a fifth to four fifths of a second for a hull).
import type { RecipeRender } from '../player/customizer.ts';
import type { Img, Recipe, Values } from '../player/texrender.ts';
import { decodePng } from '../player/png.ts';
import { ImageCache, paintFiles, runPaintJob, type PaintImg, type PaintRecipe } from './paintJob.ts';

interface Job {
  recipe: Recipe;
  values: Values;
  palettes: Record<string, number[][]>;
  dir: string;
  resolve: (img: PaintImg | null) => void;
}

/** The worker: undefined until first asked for, null when it could not be made (or failed), and the main thread renders. */
let worker: Worker | null | undefined;
let nextId = 1;
const jobs = new Map<number, Job>();
let warned = false;

function warnOnce(why: string): void {
  if (warned) return;
  warned = true;
  console.warn(`paint: ${why}; ship paint renders on the main thread, which hitches while it does`);
}

function workerOf(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    if (typeof Worker === 'undefined') throw new Error('no Worker here');
    const w = new Worker(new URL('./paintWorker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<{ id: number; width?: number; height?: number; rgba?: Uint8Array; emis?: Img; empty?: true; error?: string }>) => {
      const m = e.data;
      const job = jobs.get(m.id);
      if (!job) return;
      jobs.delete(m.id);
      if (m.error) {
        console.warn(`paint: ${job.recipe.material} did not render: ${m.error}`);
        job.resolve(null);
      } else if (m.empty || !m.rgba || !m.width || !m.height) job.resolve(null);
      else job.resolve({ width: m.width, height: m.height, rgba: m.rgba, ...(m.emis ? { emis: m.emis } : {}) });
    };
    w.onerror = (e) => {
      // The worker's script did not load (or died): everything it held renders here instead.
      e.preventDefault?.();
      worker = null;
      w.terminate();
      warnOnce(`the paint worker failed (${e.message || 'no message'})`);
      const held = [...jobs.values()];
      jobs.clear();
      for (const job of held) void renderHere(job.recipe, job.values, job.palettes, job.dir).then(job.resolve);
    };
    worker = w;
  } catch (err) {
    worker = null;
    warnOnce(`no module worker (${err instanceof Error ? err.message : String(err)})`);
  }
  return worker;
}

/** A folder as an absolute URL: the worker's own address is not the page's. */
function absolute(dir: string): string {
  try {
    return typeof location !== 'undefined' ? new URL(dir, location.href).href : dir;
  } catch {
    return dir;
  }
}

export const renderPaint: RecipeRender = (recipe, values, palettes, imageDir) => {
  const dir = absolute(imageDir);
  const w = workerOf();
  if (!w) return renderHere(recipe, values, palettes, dir);
  return new Promise<PaintImg | null>((resolve) => {
    const id = nextId++;
    jobs.set(id, { recipe, values, palettes, dir, resolve });
    w.postMessage({ id, recipe, values: [...values], palettes, dir });
  });
};

// ---------------------------------------------------------------------------------------------
// The fallback: the same render on this thread, its images cached here.
const hereCache = new ImageCache(96 * 1024 * 1024);

async function imageHere(url: string): Promise<Img | null> {
  const key = url.toLowerCase();
  const have = hereCache.get(key);
  if (have !== undefined) return have;
  let img: Img | null = null;
  try {
    if (typeof DecompressionStream !== 'undefined') {
      const res = await fetch(url);
      img = res.ok ? await decodePng(new Uint8Array(await res.arrayBuffer())) : null;
    } else img = await imageByCanvas(url);
  } catch (err) {
    console.warn('paint: could not decode', url, err);
  }
  hereCache.set(key, img);
  return img;
}

/** A PNG through a canvas, only where the browser has no DecompressionStream (the alpha comes back premultiplied there). */
function imageByCanvas(url: string): Promise<Img | null> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined' || typeof document === 'undefined') return resolve(null);
    const im = new Image();
    im.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = im.width;
      canvas.height = im.height;
      const c2 = canvas.getContext('2d', { willReadFrequently: true });
      if (!c2) return resolve(null);
      c2.drawImage(im, 0, 0);
      resolve({ width: im.width, height: im.height, rgba: c2.getImageData(0, 0, im.width, im.height).data });
    };
    im.onerror = () => resolve(null);
    im.src = url;
  });
}

async function renderHere(recipe: Recipe, values: Values, palettes: Record<string, number[][]>, dir: string): Promise<PaintImg | null> {
  const r = recipe as PaintRecipe;
  const mine = new Map<string, Img | null>();
  await Promise.all(paintFiles(r, values).map(async (f) => mine.set(f, await imageHere(`${dir}${f}`))));
  // A turn for the frame before the render takes the thread.
  await new Promise((resolve) => setTimeout(resolve, 0));
  try {
    return runPaintJob(r, values, palettes, (f) => (f ? (mine.get(f) ?? null) : null));
  } catch (err) {
    console.warn(`paint: ${recipe.material} did not render`, err);
    return null;
  }
}
