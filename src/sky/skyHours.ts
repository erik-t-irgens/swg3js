// The four hours `__debug.sky` puts a world at (the GPU port's pass 2, wave 1): dawn, noon, dusk and night, each worked out
// from the day's own path (`DayCycle`, `daycycle.ts`), so whatever moves the sun the hour named is the one its sky shows.
//
//   - **dawn** and **dusk**: the sun `SKY_HOURS.lowDeg` over the horizon, rising and setting, low enough that the air reddens
//     it and the land is about to hide it;
//   - **noon**: the sun at its highest;
//   - **night**: the sun at its lowest (on SWG's own path the moon then stands at its highest).
//
// Pure: no three, no DOM; the node test holds each hour to `DayCycle.update` itself.

/** Each hour a name `__debug.sky` takes. */
export type SkyHour = 'dawn' | 'noon' | 'dusk' | 'night';

export const SKY_HOUR_NAMES: readonly SkyHour[] = ['dawn', 'noon', 'dusk', 'night'];

/**
 * How low the sun stands at dawn and dusk, degrees over the horizon (a dial of the console's): 3 is low enough that a clear
 * air has reddened it and high enough that it is still over the land at Mos Eisley's flat.
 */
export const SKY_HOURS = { lowDeg: 3 };

/** The client's day: the first 70% of it, from 06:00, is daylight (`daycycle.ts`'s `DAY_NIGHT_SPLIT`). */
const SPLIT = 0.7;
/** The client's main light's peak: 67.5 degrees (`daycycle.ts`'s `SWG_LIGHT_ELEVATION`). */
const SWG_PEAK = ((90 - 22.5) * Math.PI) / 180;

/** The day's time (0 midnight, 0.5 noon) of a share `n` of the client's normalised day (day over [0, 0.5), night over [0.5, 1)). */
function timeOfNormalised(n: number): number {
  const r = n < 0.5 ? (n / 0.5) * SPLIT : SPLIT + ((n - 0.5) / 0.5) * (1 - SPLIT);
  const t = r + 0.25;
  return t - Math.floor(t);
}

/**
 * The day's time (`DayCycle.time`, 0 midnight, 0.5 noon) at which an hour stands: `swg` the client's own path (a planet with
 * its own sky), else the day's plain arc over a sun of the planet's peak elevation `maxElevation` (radians).
 */
export function skyHourTime(hour: SkyHour, swg: boolean, maxElevation: number): number {
  const low = (SKY_HOURS.lowDeg * Math.PI) / 180;
  const s = Math.sin(low);
  if (swg) {
    // On the client's path the light's height is sin(2πn) times the peak's sine by day.
    const sp = Math.sin(SWG_PEAK);
    const q = s / sp;
    const rise = Math.asin(q > 1 ? 1 : q) / (2 * Math.PI);
    if (hour === 'dawn') return timeOfNormalised(rise);
    if (hour === 'noon') return timeOfNormalised(0.25);
    if (hour === 'dusk') return timeOfNormalised(0.5 - rise);
    return timeOfNormalised(0.75);
  }
  // The plain arc: the sun's height is sin(a)·k over the length of (cos a, sin a·k), a = (time − 0.25)·2π.
  const k = Math.max(0.35, Math.sin(maxElevation));
  const a = Math.atan(s / (k * Math.sqrt(1 - s * s)));
  if (hour === 'dawn') return a / (2 * Math.PI) + 0.25;
  if (hour === 'noon') return 0.5;
  if (hour === 'dusk') return (Math.PI - a) / (2 * Math.PI) + 0.25;
  return 0;
}

/**
 * The sine of the sun's height at the day's time `time` (0 midnight, 0.5 noon) on the day's own path, as `DayCycle.update`
 * works it out: `swg` the client's path (the light's height sin(2πn) times the peak's sine over the normalised day), else the
 * plain arc over a sun of peak `maxElevation` (radians). What `__debug.sky` reports for an hour it has just written, which
 * the day itself takes up only at its next update (the review: the console's sun was a frame behind its clock).
 */
export function sunSineAt(time: number, swg: boolean, maxElevation: number): number {
  if (swg) {
    const r = (((time - 0.25) % 1) + 1) % 1;
    const n0 = r < SPLIT ? 0.5 * (r / SPLIT) : 0.5 + 0.5 * ((r - SPLIT) / (1 - SPLIT));
    const n = n0 >= 1 ? 0 : n0;
    return Math.sin(2 * Math.PI * n) * Math.sin(SWG_PEAK);
  }
  const a = (time - 0.25) * Math.PI * 2;
  const k = Math.max(0.35, Math.sin(maxElevation));
  const c = Math.cos(a);
  const s = Math.sin(a) * k;
  return s / Math.sqrt(c * c + s * s);
}

/** Whether a word is one of the hours. */
export function isSkyHour(v: unknown): v is SkyHour {
  return v === 'dawn' || v === 'noon' || v === 'dusk' || v === 'night';
}
