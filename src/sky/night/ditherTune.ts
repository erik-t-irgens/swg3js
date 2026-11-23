// The screen's dither's dial (the GPU port's pass 2, wave 4b, maker B; the drawing is `dither.ts`, the WebGPU side's). Pure:
// the console (`__debug.stars({ dither })`) and the tests read it with nothing of three's WebGPU build.

/**
 * `amount` 1 (feel is the owner's): a level of 255 either way at the noise's widest, the triangular noise's reach, the least
 * that takes the canvas's eight-bit rounding off whatever the picture is, so a dark sky's smooth ramp shows grain, not rings;
 * 0 none (the canvas rounds as it always did). Live: a uniform read once a render.
 */
export const DITHER_TUNE = { amount: 1 };

/** The dial's range. */
export const DITHER_RANGE = [0, 4] as const;

/** What `__debug.stars()` says of it. */
export function ditherReport(): Record<string, unknown> {
  return { amount: DITHER_TUNE.amount, does: "a triangular noise of `amount` levels of 255 either way added to the picture as the canvas rounds it (WebGPU, the chain's last pass, onto the canvas): a dark sky's eight-bit rings spread into grain; 0 none" };
}

/** Moves the dial (the console's): held to its range; words for anything held or refused. */
export function tuneDither(v: unknown): string[] {
  if (typeof v !== 'number' || !Number.isFinite(v)) return ['dither: not a number'];
  const held = v < DITHER_RANGE[0] ? DITHER_RANGE[0] : v > DITHER_RANGE[1] ? DITHER_RANGE[1] : v;
  DITHER_TUNE.amount = held;
  return held !== v ? [`dither: held to ${held}`] : [];
}

/**
 * Jimenez's interleaved-gradient noise at a pixel (`x`, `y`), 0 to 1: the very sum three's `interleavedGradientNoise` writes
 * (`fract(52.9829189 · fract(0.06711056 x + 0.00583715 y))`), for the tests' model of the dither.
 */
export function ign(x: number, y: number): number {
  const a = 0.06711056 * x + 0.00583715 * y;
  const f = a - Math.floor(a);
  const b = 52.9829189 * f;
  return b - Math.floor(b);
}

/** The second noise's offset (pixels) and the frame's step (Jimenez's golden step), which the graph adds. */
export const DITHER_FIXED = { second: [47.3, 17.9], frameStep: 5.588238, frames: 64 } as const;

/**
 * The dither's noise at a pixel and frame, in levels of 255: two of the noises summed less one (triangular, −1 to 1), times
 * `amount`. The graph's arithmetic, number for number (`dither.ts`), for the tests.
 */
export function ditherLevels(x: number, y: number, frame: number, amount = DITHER_TUNE.amount): number {
  const s = (frame % DITHER_FIXED.frames) * DITHER_FIXED.frameStep;
  return (ign(x + s, y + s) + ign(x + s + DITHER_FIXED.second[0], y + s + DITHER_FIXED.second[1]) - 1) * amount;
}
