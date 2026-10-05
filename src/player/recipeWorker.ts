// Customization renders off the main thread: the recipe renderers a ship's paint and a character give
// their customizers. Each renderer made here owns a module worker of its own (recipeWorker.worker.ts),
// made the first time it is asked for a render, so a character's recolour never queues behind a hull's
// paint; the main thread only posts a job and, when the answer lands, puts the texture on (the
// customizer's `put`, one upload). A character's renderer also hands back the normal map the values
// pick, which the customizer puts on exactly as it does a render made on this thread, so no material
// gains a normal map it would not have gained before. Where a module worker cannot be had, the same
// render runs here between frames, with a warning once: each then costs this thread its whole render.
import type { RecipeRender } from './customizer.ts';
import type { Img, Recipe, Values } from './texrender.ts';
import { decodePng } from './png.ts';
import { ImageCache, paintFiles, runRecipeJob, type JobImg, type PaintRecipe } from '../vehicles/paintJob.ts';

/** Every number here is ours. */
export const RECIPE_WORKER_TUNE = {
  /** How much decoded image a character's worker keeps, least recently used let go first. */
  characterCacheMB: 64,
};

/** What a renderer is doing, for the console. */
export interface RecipeRenderStatus {
  name: string;
  /** `idle` before its first render, `worker` once its worker is made, `here` on this thread (no worker, or `here` asked for), `failed` when the worker died and this thread took over. */
  where: 'idle' | 'worker' | 'here' | 'failed';
  /** Renders asked for and not yet answered. */
  inFlight: number;
  /** Renders answered, with something to put. */
  done: number;
  /** The last render's own time where it ran, and from asking to answer, in milliseconds. */
  lastMs: number | null;
  lastRoundMs: number | null;
  cacheMB: number;
  withNormal: boolean;
}

/** A recipe renderer, with what the console reads of it and the switch that keeps it on this thread. */
export interface RecipeRenderer extends RecipeRender {
  status(): RecipeRenderStatus;
  /** True renders on this thread even where a worker can be had (`__debug.dye({ worker: false })`, to compare). */
  here: boolean;
}

interface Job {
  recipe: Recipe;
  values: Values;
  palettes: Record<string, number[][]>;
  dir: string;
  asked: number;
  resolve: (img: JobImg | null) => void;
}

/** A folder as an absolute URL: the worker's own address is not the page's. */
function absolute(dir: string): string {
  try {
    return typeof location !== 'undefined' ? new URL(dir, location.href).href : dir;
  } catch {
    return dir;
  }
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

/**
 * A recipe renderer: `name` for its warnings and the console, `cacheMB` the decoded images its worker
 * (or, without one, this thread) keeps, `withNormal` whether it also hands back the normal map the values
 * pick (a character's renders do; a ship's paint never chooses one, and a normal map arriving on a hull's
 * material that had none would change its program).
 */
export function makeRecipeRender(opts: { name: string; cacheMB: number; withNormal: boolean }): RecipeRenderer {
  const { name, cacheMB, withNormal } = opts;
  /** The worker: undefined until first asked for, null when it could not be made (or failed), and this thread renders. */
  let worker: Worker | null | undefined;
  let failed = false;
  let nextId = 1;
  const jobs = new Map<number, Job>();
  let warned = false;
  let done = 0;
  let lastMs: number | null = null;
  let lastRoundMs: number | null = null;
  let hereInFlight = 0;

  const warnOnce = (why: string): void => {
    if (warned) return;
    warned = true;
    console.warn(`${name}: ${why}; its renders run on the main thread, which hitches while they do`);
  };

  const answered = (job: Job, img: JobImg | null, ms: number | null): void => {
    if (img) done++;
    if (ms !== null) lastMs = ms;
    lastRoundMs = performance.now() - job.asked;
    job.resolve(img);
  };

  // ---- the fallback: the same render on this thread, its images cached here.
  const hereCache = new ImageCache(cacheMB * 1024 * 1024);
  const imageHere = async (url: string): Promise<Img | null> => {
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
      console.warn(`${name}: could not decode`, url, err);
    }
    hereCache.set(key, img);
    return img;
  };
  const renderHere = async (recipe: Recipe, values: Values, palettes: Record<string, number[][]>, dir: string): Promise<JobImg | null> => {
    const r = recipe as PaintRecipe;
    const mine = new Map<string, Img | null>();
    hereInFlight++;
    const asked = performance.now();
    try {
      await Promise.all(paintFiles(r, values).map(async (f) => mine.set(f, await imageHere(`${dir}${f}`))));
      // A turn for the frame before the render takes the thread.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const t0 = performance.now();
      const img = runRecipeJob(r, values, palettes, (f) => (f ? (mine.get(f) ?? null) : null), withNormal);
      const ms = performance.now() - t0;
      answered({ recipe, values, palettes, dir, asked, resolve: () => {} }, img, ms);
      return img;
    } catch (err) {
      console.warn(`${name}: ${recipe.material} did not render`, err);
      return null;
    } finally {
      hereInFlight--;
    }
  };

  const workerOf = (): Worker | null => {
    if (worker !== undefined) return worker;
    try {
      if (typeof Worker === 'undefined') throw new Error('no Worker here');
      const w = new Worker(new URL('./recipeWorker.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<{ id: number; width?: number; height?: number; rgba?: Uint8Array; emis?: Img; normal?: Img; ms?: number; empty?: true; error?: string }>) => {
        const m = e.data;
        const job = jobs.get(m.id);
        if (!job) return;
        jobs.delete(m.id);
        if (m.error) {
          console.warn(`${name}: ${job.recipe.material} did not render: ${m.error}`);
          answered(job, null, null);
        } else if (m.empty || !m.rgba || !m.width || !m.height) answered(job, null, null);
        else answered(job, { width: m.width, height: m.height, rgba: m.rgba, ...(m.emis ? { emis: m.emis } : {}), ...(m.normal ? { normal: m.normal } : {}) }, m.ms ?? null);
      };
      w.onerror = (e) => {
        // The worker's script did not load (or died): everything it held renders here instead.
        e.preventDefault?.();
        worker = null;
        failed = true;
        w.terminate();
        warnOnce(`the worker failed (${e.message || 'no message'})`);
        const held = [...jobs.values()];
        jobs.clear();
        for (const job of held) void renderHere(job.recipe, job.values, job.palettes, job.dir).then(job.resolve);
      };
      w.postMessage({ init: { cacheMB } });
      worker = w;
    } catch (err) {
      worker = null;
      warnOnce(`no module worker (${err instanceof Error ? err.message : String(err)})`);
    }
    return worker;
  };

  const render = ((recipe, values, palettes, imageDir) => {
    const dir = absolute(imageDir);
    const w = render.here ? null : workerOf();
    if (!w) return renderHere(recipe, values, palettes, dir);
    return new Promise<JobImg | null>((resolve) => {
      const id = nextId++;
      jobs.set(id, { recipe, values, palettes, dir, asked: performance.now(), resolve });
      w.postMessage({ id, recipe, values: [...values], palettes, dir, normal: withNormal });
    });
  }) as RecipeRenderer;
  render.here = false;
  render.status = () => ({
    name,
    where: failed ? 'failed' : render.here || worker === null ? 'here' : worker ? 'worker' : 'idle',
    inFlight: jobs.size + hereInFlight,
    done,
    lastMs: lastMs === null ? null : Number(lastMs.toFixed(1)),
    lastRoundMs: lastRoundMs === null ? null : Number(lastRoundMs.toFixed(1)),
    cacheMB,
    withNormal,
  });
  return render;
}

/**
 * The renderer every character shares (the player, the people another player is drawn as, the fighters,
 * the select screen's figure): its own worker, so a recolour never waits behind a ship's paint, and the
 * normal map the values pick handed back with each render. The dressed people the mobiles stand share
 * their renders with each other instead, on this thread (`Customizer.share`).
 */
export const characterRender = makeRecipeRender({ name: 'characters', cacheMB: RECIPE_WORKER_TUNE.characterCacheMB, withNormal: true });
