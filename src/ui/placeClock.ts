// The creator's hour slider, as arithmetic: what the clock beside it reads, where the thumb sits, when
// the thumb is worth writing again, and which hours the owner captured.
//
// The slider is the whole day, midnight to midnight, by the owner's decision: the first cut offered
// only the captured hours as buttons, on the grounds that night shows no face, and the owner wanted
// the day itself instead. The captured hours stay one click away as marks on the slider and as small
// buttons beside it, because every one of them was chosen by standing there and looking.
//
// Pure of the DOM and of three, so a node test can drive it. The bar that wears it is `placeBar.ts`.

/** Every number here is ours. */
export const PLACE_CLOCK_TUNE = {
  /**
   * The slider's step, in minutes of the day. Five is fine enough that a drag reads as continuous on
   * a bar a couple of hundred pixels wide (288 steps over the day) and coarse enough that a played day
   * moves the thumb about once every two and a half seconds of a twelve-minute day.
   */
  stepMinutes: 5,
  /**
   * How long a drag must have rested before the reflections are taken again, in ms. A capture is a
   * whole sky render; taken on every step of a drag it would be dozens a second for a picture nobody
   * can see change, and taken on the clock's own four seconds it lags a scrub by that long.
   */
  settleMs: 250,
};

/** An hour of the day in [0, 24), whatever it was handed (24 is midnight again, NaN is midnight). */
export function wrapHour(hour: number): number {
  if (!Number.isFinite(hour)) return 0;
  const h = hour % 24;
  return h < 0 ? h + 24 : h;
}

/**
 * The clock beside the slider: "06:30". Rounded to the minute as one number rather than the hour and
 * the fraction apart, as `hourLabel` does, because 19.65 hours is 1178.9999 minutes in binary and
 * taking them separately reads 19:38.
 */
export function clockText(hour: number): string {
  const mins = Math.round(wrapHour(hour) * 60) % 1440;
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

/** The day's time (0 midnight, 0.5 noon) as an hour of the clock. */
export function hourOfTime(time: number): number {
  return wrapHour(time * 24);
}

/** Where the thumb sits for an hour: on the slider's own step, never past the end. */
export function snapHour(hour: number, stepMinutes = PLACE_CLOCK_TUNE.stepMinutes): number {
  const step = Math.max(1, stepMinutes) / 60;
  const h = wrapHour(hour);
  const snapped = Math.round(h / step) * step;
  return snapped >= 24 ? 0 : Number(snapped.toFixed(6));
}

/**
 * Whether a played day has moved far enough since the thumb was last written to be written again: a
 * whole step either way, the short way round the clock. A day that only crept a fraction of a step
 * writes nothing, which is the discipline every steady frame of the display keeps.
 */
export function thumbMoved(lastWritten: number, now: number, stepMinutes = PLACE_CLOCK_TUNE.stepMinutes): boolean {
  if (!Number.isFinite(lastWritten)) return true;
  let d = Math.abs(wrapHour(now) - wrapHour(lastWritten));
  if (d > 12) d = 24 - d;
  return d * 60 >= Math.max(1, stepMinutes) - 1e-9;
}

/** The owner's captured hours as marks on the slider: each one's hour, in the day's order, each once. */
export function hourTicks(hours: readonly { hour: number }[]): number[] {
  const out: number[] = [];
  for (const h of hours) {
    const v = wrapHour(h.hour);
    if (!out.some((x) => Math.abs(x - v) < 1e-6)) out.push(v);
  }
  return out.sort((a, b) => a - b);
}

/** Which captured hour the clock is standing on now, by its index, or -1 between them. */
export function capturedAt(hours: readonly { hour: number }[], hour: number, stepMinutes = PLACE_CLOCK_TUNE.stepMinutes): number {
  const half = Math.max(1, stepMinutes) / 120;
  const now = wrapHour(hour);
  for (let i = 0; i < hours.length; i++) {
    let d = Math.abs(wrapHour(hours[i].hour) - now);
    if (d > 12) d = 24 - d;
    if (d < half) return i;
  }
  return -1;
}
