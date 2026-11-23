// The output dither's dial (the sky and light fix round, maker E; the graph is `src/core/gpu/outputDither.ts`): how many 8-bit
// steps of noise the chain's last pass adds after the tone curve on WebGPU, on a slider of the `exposure` set (joined through
// `EYE_DIAL_GROUPS` as this file loads) and in `__debug.exposure({ dither })`. Wave 4b's maker B adds the night's dither of
// its own (`src/sky/night/dither.ts`); the lead keeps one of the two at the merge, and dropping this one is this file, the
// graph's file, its line in `gpuChainPasses.ts` and the console's line in `main.ts`.
//
// Pure: no three, no DOM.
import type { DialGroup } from '../../ui/dials.ts';
import { EYE_DIAL_GROUPS } from './eyeDials.ts';

/**
 * The dial (feel is the owner's; nobody tunes it by measuring): `steps` 1, the noise's full width in 8-bit steps, his demo's
 * one step (±half a step: `col += (ign(fp.xy) - 0.5) / 255.0`), which hides the rounding's steps in a smooth gradient and adds
 * no grain the eye can see; 0 is the picture rounded as before.
 */
export const OUTPUT_DITHER = { steps: 1 };

/** Its range (the slider's and the console's). */
export const OUTPUT_DITHER_RANGE = [0, 4] as const;

/** The interleaved gradient noise's numbers (Jimenez 2014, the demo's `ign`). */
export const IGN = { a: 52.9829189, x: 0.06711056, y: 0.00583715 } as const;

/** The noise at a pixel's place, 0 to 1 (the twin of the graph's, and the demo's `ign`). */
export function ignOf(px: number, py: number): number {
  const f = (v: number): number => v - Math.floor(v);
  return f(IGN.a * f(px * IGN.x + py * IGN.y));
}

/** The dial moved as the console writes it (`{ dither: 0.5 }`); words for anything held or refused. */
export function tuneOutputDither(v: unknown): string[] {
  if (typeof v !== 'number' || !Number.isFinite(v)) return ['dither: a number of 8-bit steps, 0 to 4'];
  const [lo, hi] = OUTPUT_DITHER_RANGE;
  const held = v < lo ? lo : v > hi ? hi : v;
  OUTPUT_DITHER.steps = held;
  return held !== v ? [`dither: held to ${held}`] : [];
}

/** Its slider, in the `exposure` set. */
export function ditherGroup(): DialGroup {
  return {
    title: 'The output',
    note: "After the tone curve, where the picture goes into the screen's eight bits. WebGPU's, with the effects on.",
    dials: [
      {
        kind: 'number',
        key: 'dither',
        label: 'Dither',
        note: "Noise of this many 8-bit steps added as the picture is written, so a night sky's and a haze's smooth gradients round to a fine grain instead of steps: 1 his demo's, 0 none.",
        min: OUTPUT_DITHER_RANGE[0],
        max: OUTPUT_DITHER_RANGE[1],
        step: 0.25,
        unit: 'steps',
        get: () => OUTPUT_DITHER.steps,
        set: (v) => tuneOutputDither(v),
      },
    ],
  };
}

EYE_DIAL_GROUPS.push(ditherGroup);
