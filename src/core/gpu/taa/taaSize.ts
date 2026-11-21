// The scene's size under the edge smoothing (the GPU port's pass 1, wave 6): the canvas's, or under the upscaled smoothing its
// share (`TAA_TUNE.share`), only where the smoothing can draw (a motion buffer to fill it out from). `PostFX` sizes its scene
// target, its products, the frame's context and every pass before the smoothing by it (`GpuChain.inputSize`); every reader of the
// scene's pixels reads it through the runtime (`GpuRuntime.taa.sceneSize`, `sceneSizeNow`: the portal renderer's visible set, the
// rain's and the motes' sizes in pixels, the console's rectangles), the canvas's own where no chain stands, and the share it was
// worked at, which a moved dial makes stale.
//
// Pure: nothing of three's but a vector, so a node test sizes it as the chain does.

import type * as THREE from 'three';
import { SMOOTHING, TAA_TUNE } from './taaTune.ts';

/** The scene's size as the chain draws it now, and the share it was worked at. */
export const SCENE_SIZE = { width: 1, height: 1, share: 1, upscaled: false };

/**
 * The scene's size for whatever reads its pixels (`GpuRuntime.taa.sceneSize`), into `out`: `SCENE_SIZE` while an effects chain
 * stands (`chainStands`: the smoothing's pass is made with every chain on WebGPU), else the canvas's own, which `canvas` writes
 * into `out` (the drawing buffer's). With Effects off the scene is drawn straight onto the canvas, and `SCENE_SIZE` holds the
 * last chain's size, or a pixel before any chain was made: read so, the portal renderer's padding grew to the whole screen and
 * every room counted as seen (wave 6's review; its fixer). Nothing allocated.
 */
export function sceneSizeNow(out: THREE.Vector2, chainStands: boolean, canvas: (out: THREE.Vector2) => THREE.Vector2): THREE.Vector2 {
  if (!chainStands) return canvas(out);
  return out.set(SCENE_SIZE.width, SCENE_SIZE.height);
}

/** The scene's size for a canvas `width` by `height` under the smoothing `mode`, into `out` and `SCENE_SIZE`. */
export function sceneSizeFor(width: number, height: number, mode: number, motion: boolean, out: THREE.Vector2): THREE.Vector2 {
  const up = mode === SMOOTHING.upscaled && motion;
  const s = up ? TAA_TUNE.share : 1;
  out.set(Math.max(1, Math.round(width * s)), Math.max(1, Math.round(height * s)));
  SCENE_SIZE.width = out.x;
  SCENE_SIZE.height = out.y;
  SCENE_SIZE.share = s;
  SCENE_SIZE.upscaled = up;
  return out;
}
