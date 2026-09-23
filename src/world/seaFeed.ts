// What floats reads the sea as the swell leaves it; everything else goes on reading the flat table.
//
// The water's height on the CPU has always been one number per column -- the global table's height,
// or a lake polygon's over it -- with no time in it at all (`Terrain.waterHeightAt`). The surface
// the eye sees is that height displaced by eight Gerstner waves on the GPU, so a machine hovering
// over the open sea rides a flat plane through the middle of the swell. This file is the rule for a
// **second** reader that answers the swell as well (`World.seaAt`), and for the switch that puts the
// first one back.
//
// It is deliberately not the first reader. The swell reaches about 1.19 m and a wader starts
// swimming at 1.1 m of water, so a breathing shared height would flip a body in and out of swimming
// with every crest; the swim line, the spawn heights, the feet, the blade, the splashes and the
// weather all keep the flat table and are listed in the wave's notes. Only what floats consumes
// this -- and, as a consequence of that rather than as a second decision, the two rules that measure
// a floating hull's **own** height against the water (`Vehicle.onWater` and the wake's depth
// window), since a breathing height compared against a plane is a verdict that flickers at sea.
//
// **None of the wave arithmetic is here.** The eight-wave sum, the fades' own edges, the dispersion
// relation and the inverse solve are `swellMath.ts`, which mirrors the shader and is pinned against
// its text by a test of its own; this file holds only what is **ours**: whether the swell reaches
// the springs at all, how much of it does, which of that module's two answers is taken, and how the
// answer is put back together with the flat table. One mirror of one shader, in one place.
//
// Every number below is ours and every number it leans on is the shader's.

import { SWELL_FADE, swellFade, swellHeight, swellHeightSolved, type SwellWave } from './swellMath.ts';

export type { SwellWave };

/**
 * What the springs are fed. All four are **ours**: the shader's own fade edges are `SWELL_FADE` in
 * `swellMath.ts` and are not repeated here, so there is nothing in this object that can drift away
 * from the water.
 */
export const SEA_FEED = {
  /**
   * The switch. Off, everything that floats reads the flat table again and the game is exactly what
   * it was, to the bit.
   */
  on: true,
  /**
   * A scale on the swell as the springs feel it, 1 being the sea as the wave set authors it. It is
   * the knob for a bob that has the right rhythm and too much height -- and there is a reason it
   * might: the near sea is a 3000 m plane at 200 segments, 15 m a quad, while its eight waves run
   * 7.8 m to 33.5 m, so only the longest of them is resolved by the mesh at all and the drawn
   * surface carries roughly half the authored r.m.s. A hull floating at scale 1 therefore bobs to a
   * sea the picture cannot draw. Whether that reads as wrong is the owner's eye; if it does, the
   * honest fix is a finer mesh and this is the lever until then (about 0.3 is what the one resolved
   * wave alone contributes).
   */
  scale: 1,
  /**
   * Mirror the shader's camera-distance fade as well (`swellFade`'s first term). Off by default: the
   * mesh goes flat past 900 m for want of vertices rather than for want of waves, and a hull whose
   * ride changes when the camera turns away is the worse fault of the two. With it on, the reader
   * answers what is really drawn at any distance.
   */
  farFade: false,
  /**
   * How many fixed-point steps the inverse solve takes (`swellHeightSolved`), 0 for the plain
   * forward sum. The waves carry a surface point sideways as well as up, so the height *over* a
   * given xz is not the height authored *at* it: measured on the game's own sea state the forward
   * sum is 0.047 m r.m.s. out and 0.29 m at worst, one step is within 3 mm and two within 0.4 mm.
   * One step is the default because 29 cm is a jolt a pilot would feel and a second pass over eight
   * waves, four times a step, is nothing.
   */
  solve: 1,
};

/** The keys `__debug.sea` may write. */
export type SeaFeedTune = Partial<Pick<typeof SEA_FEED, 'on' | 'scale' | 'farFade' | 'solve'>>;

/**
 * The scale the swell is really asked for at a point: the shader's own fade of the material's wave
 * height, times ours. 0 wherever the sea does not move -- the switch off, a mesh with no swell at
 * all (`uWaveHeight` 0: every lake and the far ring), water too shallow to carry one, or a scale of
 * nothing -- and a caller that gets 0 must answer the flat table without asking for a sum.
 *
 * `depth` is the water's own depth there, the surface less the ground under it. The shader reads it
 * from a 16 m grid of ground heights while a caller here reads the terrain itself, so at a shoreline
 * the two disagree over a few metres; the swell is near nothing at that depth in both, so the
 * disagreement is centimetres of height. Deep water of unknown depth should be passed as `Infinity`,
 * never 0, which reads as dry land.
 *
 * `cameraDistance` is read only while `farFade` is on; passing it 0 is what leaves the shader's far
 * term out, since the term is 1 there.
 */
export function swellScaleAt(depth: number, waveHeight: number, cameraDistance: number): number {
  if (!SEA_FEED.on) return 0;
  const ours = Number.isFinite(SEA_FEED.scale) && SEA_FEED.scale > 0 ? SEA_FEED.scale : 0;
  if (ours === 0) return 0;
  return swellFade(waveHeight, SEA_FEED.farFade ? cameraDistance : 0, depth) * ours;
}

/**
 * The swell's height at a point, at the scale `swellScaleAt` gave: the inverse solve where `solve`
 * asks for one, the plain forward sum otherwise. The scale goes **into** the call rather than onto
 * the answer, because the sideways term the solve chases is not linear in it.
 *
 * Allocates nothing and makes no closure: this is called once per hover point per physics step.
 */
export function seaSwellAt(waves: readonly SwellWave[], omega: readonly number[], x: number, z: number, time: number, scale: number): number {
  const steps = Number.isFinite(SEA_FEED.solve) && SEA_FEED.solve > 0 ? SEA_FEED.solve : 0;
  const h = steps > 0 ? swellHeightSolved(waves, omega, x, z, time, scale, steps) : swellHeight(waves, omega, x, z, time, scale);
  return Number.isFinite(h) ? h : 0;
}

/**
 * The surface a floating thing sits on: the flat table plus the swell over it.
 *
 * Every way out of it answers `flat` exactly -- the switch off, no swell, a dry column, or a number
 * that is not a number -- so a lake, a pool and a planet with no sea behave to the last bit as they
 * did before this reader existed. A hull's pose is written from what comes back, and one NaN in a
 * pose is a hull thrown out of the world, so nothing but a real number ever leaves here.
 */
export function seaHeight(flat: number, swell: number): number {
  if (!SEA_FEED.on || !Number.isFinite(flat) || !Number.isFinite(swell)) return flat;
  return flat + swell;
}

/** Write the knobs, ignoring anything that is not a finite number (or a boolean where one goes). */
export function tuneSeaFeed(t: SeaFeedTune | undefined): typeof SEA_FEED {
  if (!t) return SEA_FEED;
  if (typeof t.on === 'boolean') SEA_FEED.on = t.on;
  if (typeof t.farFade === 'boolean') SEA_FEED.farFade = t.farFade;
  const n = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
  if (n(t.scale)) SEA_FEED.scale = Math.max(0, t.scale);
  // Sixteen is the solve's own ceiling; asking for more is asking for nothing more.
  if (n(t.solve)) SEA_FEED.solve = Math.min(16, Math.max(0, Math.round(t.solve)));
  return SEA_FEED;
}

/** The numbers in force, the shader's edges they lean on, and in words why nothing is bobbing. */
export function seaFeedReport(): typeof SEA_FEED & { fade: typeof SWELL_FADE; why: string | null } {
  return {
    ...SEA_FEED,
    fade: SWELL_FADE,
    why: !SEA_FEED.on ? 'the switch is off (__debug.sea({ on: true }))' : SEA_FEED.scale > 0 ? null : 'the scale is 0, so the swell lifts nothing',
  };
}
