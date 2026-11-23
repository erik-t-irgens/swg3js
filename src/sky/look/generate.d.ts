// The little of the viewer's generated looks' bake (`generate.js`) the game's TypeScript calls (the GPU port's pass 2, wave 4b,
// maker A: `lookBake.ts`), typed loosely: the module is the viewer's own JavaScript and stays as it is.

/** The bake sizes, [width, height] each. */
export const SIZES: [number, number][];

/** One look's baked textures (surface, relief, clouds) on the card. */
export class GeneratedSet {
  constructor(width: number);
  readonly width: number;
  readonly height: number;
  key: string;
  lastMs: number;
  bakes: number;
  disposed: boolean;
  /** The bake's passes' pipelines asked for on a renderer before it bakes; resolves with the milliseconds awaited. */
  warm(renderer: unknown, gen: Record<string, unknown>, o?: { withClouds?: boolean; again?: boolean }): Promise<number>;
  /** Bake (queued after any bake already running); resolves with its milliseconds. */
  bake(renderer: unknown, gen: Record<string, unknown>, o?: { withClouds?: boolean }): Promise<number>;
  /** Every texel of one of its textures (RGBA8), or null where it has none. */
  pixels(renderer: unknown, which?: 'surface' | 'relief' | 'clouds' | 'more'): Promise<Uint8Array | null>;
  dispose(): void;
  static keyOf(gen: Record<string, unknown>, withClouds: boolean): string;
}

/** The viewer's preset looks by id (pass 2, wave 5: an extra body that names no look wears its kind's): their recipe and parts. */
export const PRESETS: Record<string, { name?: string; recipe?: string; group?: string; shape?: unknown; volume?: unknown; [k: string]: unknown }>;

/** FNV-1a over bytes: a short name for a picture's every texel. */
export function hashBytes(bytes: ArrayLike<number>): string;

/**
 * One of the viewer's preset looks made whole (its layers and its generated numbers), `extra` laid over it (the fixer of pass 2,
 * wave 4b, maker C's ask: the space volumes' default gas reads the Maelstrom's preset).
 */
export function presetLook(presetId: string, extra?: Record<string, unknown>): { generated: Record<string, unknown>; layers?: Record<string, unknown>; [k: string]: unknown };
