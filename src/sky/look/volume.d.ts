// Types for `volume.js` (the space body viewer's volumes, the game's nebula volumes since the GPU port's pass 2, wave 4b,
// maker C: `src/space/spaceVolumes.ts`), so the game's TypeScript imports it as it stands. Only what the game reads is typed;
// the module is the viewer's plain JavaScript.
/* eslint-disable @typescript-eslint/no-explicit-any */

/** The tiers: live noise or the baked volume, and the steps a ray takes. */
export const VOLUME_TIERS: Record<'high' | 'medium' | 'low', { live: boolean; steps: number; words: string }>;
export function setVolumeQuality(mode: string): void;
export function volumeTier(): 'high' | 'medium' | 'low';

/** One look's baked noise volume (128 slices of 128 by 128 in one picture), shared by every place that shows the look. */
export class VolumeSet {
  constructor();
  key: string;
  lastMs: number;
  bakes: number;
  disposed: boolean;
  readonly rt: any;
  /** Bake again if the seed or the billows' size changed; resolves with the milliseconds (0: nothing to do). */
  bake(renderer: unknown, gen: Record<string, unknown>): Promise<number>;
  dispose(): void;
  static keyOf(gen: Record<string, unknown>): string;
}

/** One volume on a stage: its sphere, its two materials (live and baked), its storm clock. */
export interface BuiltVolume {
  V: Record<string, any>;
  W: Record<string, any>;
  mesh: any;
  live: any;
  baked: any;
  set: VolumeSet;
  tier: string;
  [k: string]: any;
}

export function buildVolume(gen: Record<string, unknown>, set: VolumeSet, parent: unknown, onFlash: ((x: number, y: number, z: number, peak: number) => void) | null, opts?: { body?: boolean }): BuiltVolume;
export function syncVolume(vol: BuiltVolume, gen: Record<string, unknown>): void;
export function updateVolume(
  vol: BuiltVolume,
  o: { motion: number; wall: number; lightWorld: unknown; sunPower?: number; sunColour?: unknown; gain?: number; noStorms?: boolean },
): void;
/** The bodies in the volume's way this frame: `list` of Vector4 (world centre, world radius), `n` of them. */
export function volumeOccluders(vol: BuiltVolume, list: ArrayLike<{ x: number; y: number; z: number; w: number }>, n: number): void;
export function disposeVolume(vol: BuiltVolume | null): void;
