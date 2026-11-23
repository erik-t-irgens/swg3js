// Types for `weather.js` (the space body viewer's storms and clouds' motion), the little the game's TypeScript reads (the GPU
// port's pass 2, wave 5, maker L: `lookBody.ts` and `spaceVolumes.ts` turn its storms' recording on). The module is the viewer's
// plain JavaScript and stays as it is.
/* eslint-disable @typescript-eslint/no-explicit-any */

/** Whether storms built from now on are recorded ahead and played back (the game's), and the recording's length in seconds. */
export const STORM_TAPE: { on: boolean; seconds: number };
export const STORM_SLOTS: number;
/** The record `Storms.stepWith` reads, made once and written in place each frame. */
export function stormArgs(): { now: number; on: boolean; rate: number; bright: number; spread: number; cells: any; sizes: any };
export function weatherUniforms(): Record<string, any>;
export class Storms {
  constructor(seed?: number, disc?: boolean);
  flashes: number;
  step(now: number, on: boolean, rate: number, bright: number, spread: number, cells: any, sizes?: any): void;
  stepWith(a: ReturnType<typeof stormArgs>): void;
  record(rate: number, spread: number, seconds?: number): number;
  setHints(cyclones: any): void;
}
