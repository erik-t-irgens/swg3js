// Where a planet's day sits against the shared clock: plain arithmetic with nothing imported but the
// weather's own hash, so the server can work out the hour a browser's sky is drawn at without three or a
// page (`server/storyWorlds.mjs` reads it to know the game hour a story's condition asks about).

import { rand3 } from './weatherSchedule.ts';

/**
 * The salt the phase is hashed with. Invented, and chosen rather than picked out of the air: a hash of two
 * numbers spreads them no better than chance, and the first one tried put two of the game's planets at the
 * same hour to within half a second of a twelve-minute day. This one leaves the closest pair of the
 * thirteen suns the planet list actually has about a fortieth of a day apart, which the clock's test
 * measures over that list so that a planet added later is noticed rather than quietly colliding.
 */
export const PHASE_SALT = 29;

/**
 * Where a planet's day sits against the shared clock, in days, in [0, 1). Invented, and worked out from the
 * planet's own sun (its azimuth and its peak elevation, the two numbers the day is ever told about a
 * planet) so that it is the same number in every browser, and on the server, without anybody having to
 * carry it. `spread` is the console's knob (`dayTune.phaseSpread`); 1 is what everybody runs at.
 */
export function planetPhase(azimuth: number, maxElevation: number, spread = 1): number {
  const a = Math.round((Number.isFinite(azimuth) ? azimuth : 0) * 1000);
  const e = Math.round((Number.isFinite(maxElevation) ? maxElevation : 0) * 1000);
  const p = rand3(a, e, PHASE_SALT) * spread;
  return p - Math.floor(p);
}

/** The game hour, 0 to 23, at a time of day in [0, 1): what the story's `gameHour()` reads, in the browser and on the server alike. */
export function hourOfDay(time: number): number {
  return Number.isFinite(time) ? ((Math.floor(time * 24) % 24) + 24) % 24 : 0;
}
