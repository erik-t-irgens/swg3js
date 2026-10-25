// The Force's knock and its wave, as the Gameplay page sets them (the volumetrics pass's third wave, the owner's answer
// of 2026-10-24 to the design's Q16: "I wonder if it should have that delay. It would make it something someone could
// dodge or prepare for. Let's make it both, and we can dial the speed of them."). One record, written by the game from
// the settings (`forceKnockTravels`, `forceWaveSpeed`) and by `__debug.forceWave`, read by the knock (`forceWave.ts`) and
// by the moving air's fronts (`airMath.ts`'s `frontRadiusIn`) alike, so the wave of air and the knock arrive together.
//
// **Gameplay, never graphics**: nothing here reads a graphics setting, and the knock travels whether or not the
// volumetrics master, the dust or Effects is on (with the master off the wave is simply not drawn).
//
// No imports at all: two modules that import each other (the knock and the air's arithmetic) both read this one.

export interface ForceWaveTune {
  /** The knock lands when the power's wave reaches a body (true, the owner's "both"); false is the instant knock of before. */
  travels: boolean;
  /**
   * How fast the wave runs, times the fronts' own times (`AIR_TUNE.force.pushTime`, `pullTime`, `repulseTime`): 1 is the
   * air's own wave, about a second from the feet to the reach; 2 twice as fast, half as dodgeable [ours, the owner's dial].
   */
  speed: number;
}

/** The session's one record (a fraction from the start, so `speed` is a double from its first write). */
export const FORCE_WAVE: ForceWaveTune = { travels: true, speed: 1.5 };
FORCE_WAVE.speed = 1;

/** The speed's ends, which the Gameplay page's slider and the console share. */
export const FORCE_WAVE_SPEED = { min: 0.25, max: 4, step: 0.05 } as const;

/**
 * The Gameplay page's two settings into the record (at load and whenever either moves): the switch as it is, the speed
 * held to the slider's ends, a speed that is not a number left as it was. Answers the record.
 */
export function setForceWave(travels: unknown, speed: unknown): ForceWaveTune {
  if (typeof travels === 'boolean') FORCE_WAVE.travels = travels;
  if (typeof speed === 'number' && Number.isFinite(speed)) FORCE_WAVE.speed = speed < FORCE_WAVE_SPEED.min ? FORCE_WAVE_SPEED.min : speed > FORCE_WAVE_SPEED.max ? FORCE_WAVE_SPEED.max : speed;
  return FORCE_WAVE;
}

/** The speed as the fronts read it: never under the slider's least, never NaN. */
export function waveSpeed(): number {
  const s = FORCE_WAVE.speed;
  return s > FORCE_WAVE_SPEED.min ? s : FORCE_WAVE_SPEED.min;
}
