// The look the WebGPU stand-ins draw this step (the GPU port's step 3), each number a dial the owner moves live
// (`__debug.gpu({ look: { ... } })`), read by the stand-ins every frame. Feel and look are his; these are starts.

export const GPU_LOOK = {
  /**
   * How far up the sky the stand-in reaches its zenith colour, as the sine of the elevation (0 the horizon, 1 straight
   * up). 0.45: the dome's own gradient pictures run from their horizon colour to their top about halfway up the sky.
   */
  skyZenithAt: 0.45,
  /**
   * The lava stand-in's brightness over its ramp's middle colour. 1.6: the WebGL lava is pushed past bloom's threshold
   * by its veins, and with no effects on WebGPU the plain middle read as dull mud beside it.
   */
  lavaGlow: 1.6,
  /** The ground stand-in's grey where the chunk carries no colour of its own (0.42 in linear light: a mid grey, lit). */
  groundGrey: 0.42,
  /**
   * The ground stand-in's share of the colour map's own colour (decoded from its sRGB bytes). 1: the colour map, decoded,
   * is already near the ground's own colour; less darkens it, more lightens it.
   */
  groundTint: 1,
};

export function tuneGpuLook(o: Partial<typeof GPU_LOOK>): typeof GPU_LOOK {
  for (const k of Object.keys(GPU_LOOK) as (keyof typeof GPU_LOOK)[]) {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v)) GPU_LOOK[k] = v;
  }
  return GPU_LOOK;
}
