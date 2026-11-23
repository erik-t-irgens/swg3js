// Types for `shapes.js` (the space body viewer's shapes, rocks and rings: plain JavaScript on the WebGPU side), so the game's
// TypeScript imports what it reads of it as it stands (the GPU port's pass 2, wave 5, maker M: the galaxy map's opened system
// wears a look's rings by the viewer's own profile, handed over by the runtime, `src/core/gpu/start.ts`' `mapRings`). Only what
// the game reads is typed; the module is the viewer's.

/** A ring's profile across it, baked from its dials into a 1024 by 1 RGBA picture (density, colour mix, brightness). */
export function ringProfile(seed: number, style: string, dials: Record<string, number | string>): { image: { data: Uint8Array; width: number; height: number }; dispose(): void };
/** How far a ring's style throws light forward (dust much, ice little). */
export function ringScatter(style: string): number;
