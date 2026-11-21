// The effects chain's walk on WebGPU (the GPU port's pass 1, wave 6), `PostFX`'s own steps for each pass that draws, with the
// buffers of two sizes the edge smoothing needs: the passes before the smoothing draw in the scene's size (`lowA`, `lowB`) and,
// from the smoothing's place in the registry on, in the canvas's (`bufferA`, `bufferB`), the smoothing writing one of the canvas's
// from one of the scene's. Where the sizes agree the two pairs are one and the walk is the WebGL walk's. And which size each pass
// is given (`passAtSceneSize`).
//
// Pure and apart from `PostFX` so a node test runs it as the chain does (`gpuTaa.test.ts`); it imports nothing of three's. Only
// `PostFX`'s WebGPU branch calls it; the WebGL walk is `PostFX.end`'s own, as it was.

import { fxPassIndex, type FxPassId } from '../fxRegistry.ts';

/** What the walk needs of a pass: `FxPass`'s steps. */
export interface WalkPass<C, T> {
  readonly id: FxPassId;
  readonly timerLabel: string;
  prepare(ctx: C): void;
  render(ctx: C, input: T, output: T | null): boolean;
}

/** The chain's targets: the scene, the scene's two buffers and the canvas's two (one pair where the sizes agree). */
export interface WalkTargets<T> {
  scene: T;
  lowA: T;
  lowB: T;
  bufferA: T;
  bufferB: T;
}

/** The chain's timer's two steps. */
export interface WalkTimer {
  begin(label: string): void;
  end(label: string): void;
}

/**
 * Every pass on in `on` up to `last` in turn, as `PostFX.end` walks them: prepared, timed, drawn from what the last wrote into the
 * next buffer (the canvas for the last), and the buffers swapped where it wrote; `after` (the error check, when asked) after each.
 * Nothing allocated.
 */
export function walkChainGpu<C, T>(ctx: C, passes: readonly WalkPass<C, T>[], on: readonly boolean[], last: number, t: WalkTargets<T>, timer: WalkTimer, after: ((label: string) => void) | null): void {
  let read = t.scene;
  let write = t.lowA;
  let low = true;
  for (let i = 0; i <= last; i++) {
    const pass = passes[i];
    // From the smoothing's place on, the canvas's buffers, never the one the smoothing reads.
    if (low && pass.id === 'taa') {
      low = false;
      write = read === t.bufferA ? t.bufferB : t.bufferA;
    }
    if (!on[i]) continue;
    const toScreen = i === last;
    pass.prepare(ctx);
    timer.begin(pass.timerLabel);
    const wrote = pass.render(ctx, read, toScreen ? null : write);
    timer.end(pass.timerLabel);
    if (after !== null) after(pass.timerLabel);
    if (wrote && !toScreen) {
      read = write;
      if (low) write = read === t.lowA ? t.lowB : t.lowA;
      else write = read === t.bufferA ? t.bufferB : t.bufferA;
    }
  }
}

/** Whether a pass draws at the scene's size (it stands before the smoothing) or the canvas's (the smoothing and after). */
export function passAtSceneSize(id: FxPassId): boolean {
  return fxPassIndex(id) < fxPassIndex('taa');
}
