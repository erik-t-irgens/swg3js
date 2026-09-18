// The lit blades the effects are told about each frame: a kept list the game refills in drawFrame
// and the glow pass reads through the frame context. Only three and the blade count, so the context
// can build one without pulling in any pass.
import * as THREE from 'three';
import { BLADE_GLOW_MAX } from './bladeGlowMath.ts';

export interface FxBlade {
  /** World: the emitter. */
  readonly a: THREE.Vector3;
  /** World: the end of the lit part as drawn. */
  readonly b: THREE.Vector3;
  /** Linear: the glow colour, toward white by the tune's `whiteness`. */
  readonly color: THREE.Color;
  /** How far the blade is out, 0 to 1. */
  ignition: number;
  /** Ignition times the distance fade: what the light is scaled by. */
  intensity: number;
  /** The player's: their blades are marched together. */
  own: boolean;
}

export interface FxBladeList {
  readonly items: readonly FxBlade[];
  count: number;
  /** Luminance over pi: the brightest a white surface near these blades can be from every light but the blades (the game fills it). */
  litCeiling: number;
  /** World: which way is up for floors: +Y, or aboard a ship the hull's up. */
  readonly up: THREE.Vector3;
}

/** BLADE_GLOW_MAX kept entries with every vector made once; empty, a ceiling of 1, up +Y. */
export function createBladeList(): FxBladeList {
  const items: FxBlade[] = [];
  for (let i = 0; i < BLADE_GLOW_MAX; i++) items.push({ a: new THREE.Vector3(), b: new THREE.Vector3(), color: new THREE.Color(), ignition: 0, intensity: 0, own: false });
  return { items, count: 0, litCeiling: 1, up: new THREE.Vector3(0, 1, 0) };
}

/**
 * The frame context's list until the first frame hands it the game's own; never filled. The glow
 * pass still seeing this one after a frame has run means the hand-over in `updateContext` is
 * missing, and it says so rather than lighting nothing in silence.
 */
export const UNSET_BLADES: FxBladeList = createBladeList();
