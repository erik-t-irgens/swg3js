// His looks baked on the game's card (the GPU port's pass 2, wave 4b, maker A; the design's 2.10, "load time", and 3, way 1):
// a generated look's pictures made by the viewer's own bake (`generate.js`'s `GeneratedSet`, the one `build.js` bakes every
// generated look with) on the game's renderer, behind a loading screen, read back (the viewer's `generatedPixels`) and kept
// by the look's hash in the browser's storage (`bakeCache.ts`), so only a first arrival bakes, within the screen's budget; a
// look not baked shows SWG's picture until the next loading screen. Its pictures serve the sky's bodies (`skyLooks.ts`'s disc
// pictures), the space planets and the galaxy map's globes (maker C: `GpuLooks` in `src/core/gpuSwitch.ts`, the API note).
//
// **The kits compile ahead** (the design's "recipe kits compile on the boot screen"): the shaders of a look's bake are large
// (a recipe's whole surface, its relief and its clouds), and on a cold shader cache this card took some 30 s to make one
// kit's five pipelines behind a loading screen, where a bake with its kit made takes 30 ms. So the screen's start asks for
// the kits of every look its zone's places wear (`warm`, never awaited there) while the world loads, and a bake waits for its
// kit only as long as the screen's budget has left: a kit not landed by then leaves its look in SWG's picture on this screen,
// its pipelines landing in their own time (asked behind the screen, never by a draw) for the next.
//
// The WebGPU side's: reached through the runtime (`GPU.rt.looks`), never loaded on the WebGL path (`gpuOff.test.ts`). Nothing
// here runs in a frame: every call is made behind a loading screen, or answers from the memo (`baked`).

import * as THREE from 'three/webgpu';
import { GeneratedSet } from './generate.js';
import { bakeCache } from '../bodies/skyBody.ts';
import { BAKE_TUNE } from '../bodies/bakeCache.ts';
import { lookBakeSize, lookHasClouds, lookPicturesKey, type LookPictures } from './lookPictures.ts';
import { LOOK_BODY_TUNE } from '../bodies/lookBodyMath.ts';
import type { BodyLook } from './bodiesFile.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** What the bakes have done this session, for `__debug.sky({ looks: true })` and the proofs. */
export const LOOK_BAKE_STATS = {
  /** Bakes made on the card, pictures read from the browser's storage, from the session's memo, and put off for the budget. */
  baked: 0,
  stored: 0,
  memo: 0,
  fallback: 0,
  /** Kits asked for ahead (their pipelines), and the looks put off because their kit had not landed within the budget. */
  kitsAsked: 0,
  kitWaits: 0,
  /** How long each kit took to land from its ask, milliseconds (the first 32). */
  kitLandedMs: [] as number[],
  /** The milliseconds a bake waited on its kit, the bakes' passes and read-backs, in all. */
  warmMs: 0,
  bakeMs: 0,
  /** A read-back that came back empty (a pass not drawn): not kept, its look in SWG's picture. */
  empty: 0,
  /** Pictures let go from the memo once their reader had them, the storage holding them (`release`). */
  released: 0,
  /** The last bake's words. */
  last: '' as string,
};

/** The pictures had this session, by key (one record a look a size: every reader shares it). */
const HAD = new Map<string, LookPictures>();

/**
 * Each kit's ask, by the look's key: its promise, and whether it answered as landed. The game's warm-up answers a call once
 * its pipelines have landed or `WARM_TUNE.landMs` (30 s) has gone by, counting them lost: an answer that late is not taken
 * for a landing (this card's kit took longer than that on a cold shader cache, and a bake drawn then waited some 80 s on the
 * card's compile), so the next bake asks again, an ask that answers at once where the pipelines have landed since.
 */
interface KitAsk {
  p: Promise<number>;
  clean: boolean;
  done: boolean;
  /** The set the kit was asked against (its passes against its own targets), kept for the bake that follows. */
  set: GeneratedSet | null;
}
const KITS = new Map<string, KitAsk>();
/** An answer this late is the warm-up's own bound, not a landing. */
const LOST_AFTER_MS = 25000;

/** The generated numbers a bake is made from, at a size. */
const genOf = (look: BodyLook, size: number): Any => ({ ...(look.generated as Record<string, unknown>), size });

/** A kit's pipelines asked for (once a key, or again where its last ask answered late; the promise answers when it is). */
function askKit(renderer: Any, key: string, gen: Any, size: number, clouds: boolean): KitAsk {
  const had = KITS.get(key);
  if (had && (!had.done || had.clean)) return had;
  had?.set?.dispose();
  const set = new GeneratedSet(size);
  LOOK_BAKE_STATS.kitsAsked++;
  const t0 = performance.now();
  const ask: KitAsk = { p: Promise.resolve(0), clean: false, done: false, set };
  ask.p = set
    .warm(renderer, gen, { withClouds: clouds, again: !!had })
    .then((ms) => {
      const took = performance.now() - t0;
      ask.done = true;
      ask.clean = took < LOST_AFTER_MS;
      if (LOOK_BAKE_STATS.kitLandedMs.length < 32) LOOK_BAKE_STATS.kitLandedMs.push(Math.round(took));
      return ms;
    });
  KITS.set(key, ask);
  return ask;
}

/**
 * (The fixer of pass 2, wave 5) The kits put off behind a loading screen, by key, asked once it is gone (`askKitsLater`): on a
 * cold shader cache a kit's five large pipelines took 8 to 30 s here, and asked under a screen they held its own pipelines back
 * (an applied system's extra bodies and the map's opened systems asked theirs behind every screen, and Yavin 4's first one
 * waited 25 s on the people's shaders queued behind them). Asked in play they land off the frame, never by a draw, for the
 * next screen.
 */
const LATER = new Map<string, { gen: Any; size: number; clouds: boolean }>();

function askLaterFor(key: string, gen: Any, size: number, clouds: boolean): void {
  if (!KITS.has(key) && !LATER.has(key)) LATER.set(key, { gen, size, clouds });
}

/** The kits put off behind the screen just gone asked now, at most `LOOK_BODY_TUNE.kitsAfterScreen` of them. Answers how many. */
export function askKitsLater(renderer: Any): number {
  let n = 0;
  for (const [key, k] of LATER) {
    if (n >= LOOK_BODY_TUNE.kitsAfterScreen) break;
    LATER.delete(key);
    if (KITS.has(key)) continue;
    askKit(renderer, key, k.gen, k.size, k.clouds);
    n++;
  }
  return n;
}

/**
 * (The fixer of pass 2, wave 5) Whether a generated look's kit has landed, waiting for it at most `waitMs`: asked through the
 * same memo the screen's own warm and bakes ask (`askKit`), so a kit asked at the screen's start is the one waited on, and one
 * not landed in time keeps landing on its own (asked behind the screen, never by a draw) for the next screen. A look that is
 * not generated has no kit: true.
 *
 * (The fixer of pass 2, wave 6: the owner's "one loading screen for everything") a kit the screen's start did not ask for (an
 * applied system's extra body's preset) is a look the arrival shows all the same: it is asked here and waited on like the
 * rest, where wave 5 put it off to the screen after. Only `waitMs` 0 (the dial at nought) keeps wave 5's put-off.
 */
export async function kitWithin(renderer: Any, look: BodyLook, size: number, waitMs: number): Promise<boolean> {
  if (!look?.generated) return true;
  const clouds = lookHasClouds(look);
  const key = lookPicturesKey(look, size, clouds);
  // with no wait at all, a kit the screen's start did not ask for is asked once the screen is gone (`askKitsLater`)
  if (!KITS.has(key) && !(waitMs > 0)) {
    askLaterFor(key, genOf(look, size), size, clouds);
    return false;
  }
  const kit = askKit(renderer, key, genOf(look, size), size, clouds);
  if (kit.done) return kit.clean;
  let landed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const tw = performance.now();
  await Promise.race([
    kit.p.then(() => {
      landed = kit.clean;
    }),
    new Promise<void>((r) => {
      timer = setTimeout(r, waitMs > 0 ? waitMs : 0);
    }),
  ]);
  if (timer) clearTimeout(timer);
  LOOK_BAKE_STATS.warmMs += performance.now() - tw;
  if (!landed) LOOK_BAKE_STATS.kitWaits++;
  return landed;
}

/** Whether a read-back holds a drawn picture (a pass not drawn leaves the target cleared: every texel nought). */
function drawn(px: Uint8Array): boolean {
  const step = Math.max(4, (Math.floor(px.length / 4 / 997) | 0) * 4);
  for (let i = 0; i < px.length; i += step) if (px[i] | px[i + 1] | px[i + 2] | px[i + 3]) return true;
  return false;
}

/**
 * A bake on the card: its kit waited on for at most `waitMs` (else null: put off), then its passes drawn and read back, the
 * set let go. Null too where a read-back came back empty.
 */
async function bakeOnCard(renderer: Any, key: string, look: BodyLook, size: number, clouds: boolean, waitMs: number): Promise<Uint8Array[] | null> {
  const gen = genOf(look, size);
  const tw = performance.now();
  const kit = askKit(renderer, key, gen, size, clouds);
  let landed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  await Promise.race([
    kit.p.then(() => {
      landed = kit.clean;
    }),
    new Promise<void>((r) => {
      timer = setTimeout(r, waitMs > 0 ? waitMs : 0);
    }),
  ]);
  if (timer) clearTimeout(timer);
  const waited = performance.now() - tw;
  LOOK_BAKE_STATS.warmMs += waited;
  if (!landed) {
    LOOK_BAKE_STATS.kitWaits++;
    LOOK_BAKE_STATS.last = `${String(gen.recipe)} ${size}: its kit's pipelines not landed within ${waitMs.toFixed(0)} ms; SWG's picture until the next screen`;
    return null;
  }
  // the very set its kit was asked against (its targets are what the pipelines were made for); let go after the read-back
  const set = kit.set && !kit.set.disposed ? kit.set : new GeneratedSet(size);
  kit.set = null;
  try {
    const tb = performance.now();
    await set.bake(renderer, gen, { withClouds: clouds });
    const surface = (await set.pixels(renderer, 'surface')) as Uint8Array | null;
    const cloudPx = clouds ? ((await set.pixels(renderer, 'clouds')) as Uint8Array | null) : null;
    const ms = performance.now() - tb;
    LOOK_BAKE_STATS.bakeMs += ms;
    LOOK_BAKE_STATS.last = `${String(gen.recipe)} ${size}${clouds ? ' with clouds' : ''}: waited ${waited.toFixed(1)} ms on its kit, the bake and read-back ${ms.toFixed(1)} ms`;
    if (!surface || surface.length !== size * (size / 2) * 4) return null;
    if (!drawn(surface) || (clouds && (!cloudPx || !drawn(cloudPx)))) {
      LOOK_BAKE_STATS.empty++;
      return null;
    }
    const parts = [new Uint8Array(surface.buffer.slice(surface.byteOffset, surface.byteOffset + surface.byteLength))];
    if (clouds) {
      if (!cloudPx || cloudPx.length !== surface.length) return null;
      parts.push(new Uint8Array(cloudPx.buffer.slice(cloudPx.byteOffset, cloudPx.byteOffset + cloudPx.byteLength)));
    }
    return parts;
  } finally {
    set.dispose();
  }
}

/**
 * The game's looks' bakes on one renderer (the runtime makes one a session). `warm` and `bake` are for a loading screen
 * alone; `baked` answers from the memo and may be asked anywhere.
 */
export class LookBaker {
  private readonly renderer: Any;
  constructor(renderer: THREE.WebGPURenderer | Any) {
    this.renderer = renderer;
  }

  /**
   * A look's kit asked for ahead, at a loading screen's start (never awaited): nothing where the session or the browser's
   * storage already holds its pictures (they are read into the memo here), else its bake's pipelines, which land while the
   * screen loads the world.
   */
  async warm(look: BodyLook, most: number): Promise<void> {
    if (!look?.generated) return;
    const size = lookBakeSize(look, most);
    const clouds = lookHasClouds(look);
    const key = lookPicturesKey(look, size, clouds);
    const k = KITS.get(key);
    if (HAD.has(key) || (k && (!k.done || k.clean))) return;
    if (await bakeCache().holds(key)) return;
    askKit(this.renderer, key, genOf(look, size), size, clouds);
  }

  /**
   * A look's pictures at a size (at most `most` wide: `LOOK_BAKE_TUNE.skySize` or `.spaceSize`, never over the look's own),
   * from this session's memo, the browser's storage, or baked now where the screen's budget has room (its kit waited on for
   * what the budget has left); null where it is put off to the next screen (its reader draws SWG's picture), or the look
   * cannot be baked. Behind a loading screen alone. `shown` (the fixer of pass 2, wave 6): a look the arrival shows (a sky
   * card's disc picture, a space planet's), whose kit and bake are given the screen's whole kit wait (`LOOK_BODY_TUNE.kitWaitMs`)
   * rather than the bake cache's `BAKE_TUNE.budgetMs`, so the screen waits until it is baked (the owner's "one loading screen
   * for everything"); the map's globes leave it false.
   */
  async bake(id: string, look: BodyLook, most: number, mayAsk = true, shown = false): Promise<LookPictures | null> {
    if (!look?.generated) return null;
    const size = lookBakeSize(look, most);
    const clouds = lookHasClouds(look);
    const key = lookPicturesKey(look, size, clouds);
    const had = HAD.get(key);
    if (had) {
      LOOK_BAKE_STATS.memo++;
      return had.id === id ? had : { ...had, id };
    }
    const cache = bakeCache();
    // (the fixer of pass 2, wave 5) `mayAsk` false: a look whose kit this session has not asked for is put off and its kit asked
    // once the screen is gone (`askKitsLater`; the map's opened systems' bakes); the browser's storage still answers
    const budget = shown && LOOK_BODY_TUNE.kitWaitMs > BAKE_TUNE.budgetMs ? LOOK_BODY_TUNE.kitWaitMs : BAKE_TUNE.budgetMs;
    const got = await cache.takeBytes(
      key,
      () => {
        if (mayAsk || KITS.has(key)) return bakeOnCard(this.renderer, key, look, size, clouds, budget - cache.stats.screenMs);
        askLaterFor(key, genOf(look, size), size, clouds);
        return Promise.resolve(null);
      },
      budget,
    );
    if (!got.parts) {
      LOOK_BAKE_STATS.fallback++;
      return null;
    }
    if (got.how === 'baked') LOOK_BAKE_STATS.baked++;
    else if (got.how === 'stored') LOOK_BAKE_STATS.stored++;
    else LOOK_BAKE_STATS.memo++;
    const pics: LookPictures = { id, key, width: size, height: size / 2, surface: got.parts[0], clouds: clouds ? (got.parts[1] ?? null) : null, how: got.how === 'fallback' ? 'baked' : got.how };
    HAD.set(key, pics);
    return pics;
  }

  /** A look's pictures where this session has them (never a bake, never the storage): for a reader in play or a later screen. */
  baked(look: BodyLook, most: number): LookPictures | null {
    if (!look?.generated) return null;
    const size = lookBakeSize(look, most);
    return HAD.get(lookPicturesKey(look, size, lookHasClouds(look))) ?? null;
  }

  /**
   * A look's pictures at a size let go from the session's memo once the reader has made what it draws from them (the sky's disc
   * picture, a space planet's texture, the map's halved globe), where the browser's storage holds them: the next screen reads
   * them back, so only a first arrival bakes still (the fixer of pass 2, wave 4b; the memo kept every bake at every size, 16 MB
   * a space planet). Kept where the storage refused them. Behind a loading screen alone.
   */
  release(look: BodyLook, most: number): void {
    if (!look?.generated) return;
    const key = lookPicturesKey(look, lookBakeSize(look, most), lookHasClouds(look));
    if (bakeCache().dropBytes(key)) {
      HAD.delete(key);
      LOOK_BAKE_STATS.released++;
    }
  }

  /** The session's pictures let go (the console's: the next screen reads the storage, or bakes again). */
  forget(): void {
    HAD.clear();
    bakeCache().forgetMemo();
  }

  /** The kits put off behind the screen just gone asked now (`askKitsLater`): the world calls it as each screen goes. */
  askLater(): number {
    return askKitsLater(this.renderer);
  }

  /** What the bakes have done. */
  report(): Record<string, unknown> {
    return { ...LOOK_BAKE_STATS, had: HAD.size, kits: KITS.size, cache: { ...bakeCache().stats } };
  }
}
