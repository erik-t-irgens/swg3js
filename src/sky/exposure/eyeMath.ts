// The eye (the GPU port's pass 2, wave 2; the design's 2.8): how bright the picture is made, measured on the card each
// frame and eased like an eye, with a rule that keeps nights dark but readable. This file is the arithmetic, pure (no three,
// no DOM), so a node test runs it; the card's two compute passes (`eyeGpu.ts`) do the very same sums in three's shading
// language, every number read from the tables here, and `__debug.exposure({ check: true })` holds the card's answer to these
// functions over the histogram it read back.
//
// What it does, a frame:
//   - **the measure**: a quarter-size copy of the scene (taken before the bloom, whose levels see only highlights) as each
//     pixel's log2 luminance, counted into `EYE_FIXED.bins` bins over `minLog` to `maxLog`, each pixel weighted toward the
//     middle of the view (`centreWeight`: an eye looks where it looks);
//   - **the scene's brightness**: the mean log2 luminance of the counted weight between the 40th and the 96th percentiles
//     (`percentileMean`), so the darkest corners and the sun, the sky's glare and a lamp's core never steer it;
//   - **the full make-up** `m`: the stops the eye would add to bring that brightness to its key (`EYE_FIXED.key`), positive
//     into the dark, negative into glare;
//   - **dark nights** (`kneeStops`): up to the knee every stop is made up; past it only `share` of each further stop, and
//     never more than `most` stops short of the full make-up; never more than `floor` stops over the day's exposure;
//   - **the ease** (`easeStops`): toward the target in stops, by an exponential of its own time constant, faster into light
//     (`intoLight`) than into the dark (`intoDark`); at a loading screen it is taken at once (`snap`);
//   - **what it hands out**: the exposure `2^stops` (the output, the bloom's threshold and the grade read it) and the glow
//     factor `2^(-glow · stops)` the emissive things (sabers, lamps, bolts, city lights, every unlit surface) are drawn
//     with, so at `glow` 1 they look as they did at an exposure of 1 whatever the eye does.
//
// The player's own Exposure (±2 stops, the Graphics page) is the output's, over all of it; "off" (the Eye adaptation row)
// follows the sun's height instead of measuring (`offStops`, through the same dark-night rule).

/**
 * The eye's dials (the debug menu's `exposure` sliders and `__debug.exposure({ tune })`). Feel is the owner's: each starts
 * where the design and its proofs say, with the reason beside it, and nobody tunes them by measuring.
 *   - `intoLight` 0.3 s: the ease's time constant toward a brighter scene. Three of them are 0.9 s, so stepping out of the
 *     cantina into the noon street the glare has settled within a second (the design's proof: "the glare settles within 1 s").
 *   - `intoDark` 0.65 s: toward a darker one. Three of them are about 2 s, so stepping in from the street the room reads
 *     within about two seconds (the design's "the room reads within about 2 s"): slower than into light, as an eye is.
 *   - `knee` 2 stops: the make-up over the day's exposure that is made up in full. A shaded street, an overcast day or a
 *     doorway's shade, all within two stops of the open day, look as bright as the day, as an eye makes them; past it the
 *     darkness is partly kept.
 *   - `share` 0.7: of each stop past the knee, the share made up (the design's "only 0.7 of each stop is made up").
 *   - `most` 4 stops: the most the picture is ever kept short of the full make-up (the design's "4 stops at most"): a
 *     physical moonlit night, some eighteen stops under noon, then shows four stops under the day's key, dark but readable.
 *   - `centre` 3: the middle of the view's extra weight in the count (four times the edges' at the very middle, falling off
 *     over about a third of the view), so what is looked at steers the eye more than what is at the frame's edge.
 *   - `floor` 20 stops: the eye's own night floor (not the air's, which is gone), the most exposure over the day's it ever
 *     adds; a moonlit night needs about 14 after the knee, so it binds only where nothing at all is lit.
 *   - `glow` 1: the emissive things' compensation (the design's "set for an exposure of 1"): at 1 a saber, a lamp, a bolt or
 *     a lit window looks as it did at an exposure of 1 however far the eye has opened; at 0 it takes the eye's exposure like
 *     everything else, sixteen times brighter at +4 stops.
 */
export const EYE_TUNE = { intoLight: 0.3, intoDark: 0.65, knee: 2, share: 0.7, most: 4, centre: 3, floor: 20, glow: 1 };

/** The dials' ranges (the sliders' and the console's alike). */
export const EYE_TUNE_RANGE: { readonly [K in keyof typeof EYE_TUNE]: readonly [number, number] } = {
  intoLight: [0.02, 5],
  intoDark: [0.02, 10],
  knee: [0, 12],
  share: [0, 1],
  most: [0, 12],
  centre: [0, 12],
  floor: [0, 24],
  glow: [0, 1],
};

/**
 * What is not a dial: the count's layout and the anchor.
 *   - `bins` 256 over `minLog` -26 to `maxLog` 10 (log2 of the scene's luminance): 36 stops, a seventh of a stop a bin, from
 *     under the half float's last subnormal (a moonlit sky's 1e-7 is -23) to over the sanitize's ceiling of 256 (8).
 *   - `low` 0.4 and `high` 0.96: the percentiles the mean is taken between (the design's 40th to 96th).
 *   - `spread` 0.35: the centre weight's fall-off, as a share of the view's half diagonal.
 *   - `unit` 16: one pixel's weight in the count's whole numbers at no extra weight (the card's histogram is atomic integers).
 *   - `key` 0.39, the scene's mean luminance the eye brings to an exposure of 1: Mos Eisley's street at a clear noon as
 *     today's sky lights it (SWG's ramps, the exposure 1 the owner has always seen). Measured in the running game by this
 *     wave: the eye's own mean of that view under the air at noon, clear, the steer at 0 (`__debug.exposure()`, 0.5425), over
 *     the 1.39 times today's light wave 1's measurer found the air's noon there; so under the air's brighter noon the eye
 *     closes 0.475 stops and the street reads as it did, and nothing re-anchors the air.
 *   - `least` -12: the least stops (the most the eye closes for glare).
 */
export const EYE_FIXED = { bins: 256, minLog: -26, maxLog: 10, low: 0.4, high: 0.96, spread: 0.35, unit: 16, key: 0.39, least: -12 };

/**
 * The anchor of "off" (the eye not measuring, following the sun's height): the light on a level surface under today's clear
 * Tatooine noon's sun alone, its key light (`TODAY_NOON_KEY`, 1.903) times the sine of its 67.5 degrees, which "off" brings
 * to an exposure of 1; the air's sky and second sun beside it then close the eye a little, as they brighten the scene.
 */
export const OFF_LEVEL_REF = 1.903 * Math.sin((67.5 * Math.PI) / 180);

/** The slots of the eye's buffer on the card (`eyeGpu.ts`), read by the console and its proofs. */
export const EYE_SLOT = { exposure: 0, glow: 1, stops: 2, target: 3, mean: 4, full: 5, weight: 6, frames: 7 } as const;
export const EYE_FLOATS = 8;

/** A count the dials move by. */
export const EYE_STATE = { version: 0 };

/** The bin a log2 luminance falls in (held to the range). */
export function binOf(log2L: number): number {
  const F = EYE_FIXED;
  const t = (log2L - F.minLog) / (F.maxLog - F.minLog);
  const i = Math.floor(t * F.bins);
  return i < 0 ? 0 : i > F.bins - 1 ? F.bins - 1 : i;
}

/** A bin's middle, log2 luminance. */
export function binCentreLog(i: number): number {
  const F = EYE_FIXED;
  return F.minLog + ((i + 0.5) * (F.maxLog - F.minLog)) / F.bins;
}

/**
 * A pixel's weight in the count's whole numbers, at `px`, `py` its place in the view (-1 to 1 each way): one `unit` at the
 * edges, `1 + centre` units at the very middle, the bump a Gaussian of `spread` of the half diagonal. Rounded as the card does
 * (`floor(w · unit + 0.5)`).
 */
export function weightAt(px: number, py: number): number {
  const F = EYE_FIXED;
  const r2 = (px * px + py * py) * 0.5;
  const s = F.spread;
  const w = 1 + EYE_TUNE.centre * Math.exp(-r2 / (2 * s * s));
  return Math.floor(w * F.unit + 0.5);
}

/**
 * The mean log2 luminance of the count between the `low` and `high` percentiles (each bin at its middle, a bin cut by a
 * percentile counted by the share inside), into `out[0]`, and the count's whole weight into `out[1]`. `out[0]` is NaN when
 * nothing was counted.
 */
export function percentileMean(hist: ArrayLike<number>, out: { [i: number]: number }): void {
  const F = EYE_FIXED;
  let total = 0;
  for (let i = 0; i < F.bins; i++) total += hist[i];
  const lo = total * F.low;
  const hi = total * F.high;
  let cum = 0;
  let sum = 0;
  let w = 0;
  for (let i = 0; i < F.bins; i++) {
    const h = hist[i];
    const a = cum < lo ? lo : cum > hi ? hi : cum;
    const c = cum + h;
    const b = c < lo ? lo : c > hi ? hi : c;
    const part = b - a;
    sum += part * binCentreLog(i);
    w += part;
    cum = c;
  }
  out[0] = w > 0 ? sum / w : Number.NaN;
  out[1] = total;
}

/** The full make-up, in stops: what brings a scene of mean log2 luminance `mean` to the key. */
export function fullStops(mean: number): number {
  return Math.log2(EYE_FIXED.key) - mean;
}

/**
 * The kept numbers a frame's rule works through (`EK[0]` the full make-up in, `EK[1]` the stops made up out): a number handed
 * to or back from a call the compiler leaves out is a number made (CLAUDE.md), so the main thread's frame calls `kneeInto`
 * with nothing across the call.
 */
export const EK = new Float64Array(2);

/**
 * The dark-night rule from `EK[0]` into `EK[1]` (`kneeStops`'s body). Written with `Math.max` and `Math.min` and no
 * conditional write of a dial's number into a local: that form boxed the number on every call (16 B a frame in one process in
 * two, `eyeAlloc.test.ts`; the crowd's lesson in `performance.md`).
 */
export function kneeInto(): void {
  const T = EYE_TUNE;
  const m = EK[0];
  const k = T.knee;
  const past = Math.max(k + T.share * (m - k), m - T.most);
  const s = m > k ? past : m;
  EK[1] = Math.max(Math.min(s, T.floor), EYE_FIXED.least);
}

/**
 * The dark-night rule: the stops made up for a full make-up of `m`. Up to the knee all of it; past it `share` of each stop,
 * but never more than `most` short; held to `floor` and `least`.
 */
export function kneeStops(m: number): number {
  EK[0] = m;
  kneeInto();
  return EK[1];
}

/** One frame's ease from `prev` toward `target` stops over `dt` seconds: into light by `intoLight`'s constant, into the dark by `intoDark`'s. */
export function easeStops(prev: number, target: number, dt: number): number {
  const tau = target < prev ? EYE_TUNE.intoLight : EYE_TUNE.intoDark;
  const k = 1 - Math.exp(-(dt > 0 ? dt : 0) / (tau > 1e-3 ? tau : 1e-3));
  return prev + (target - prev) * k;
}

/** The exposure a number of stops is. */
export function exposureOf(stops: number): number {
  return Math.pow(2, stops);
}

/** The emissive things' factor at a number of stops (`glow` of the eye's stops taken back off). */
export function glowOf(stops: number): number {
  return Math.pow(2, -EYE_TUNE.glow * stops);
}

/** The stops "off" makes up for a light of `level` on a level surface (scene units), through the same dark-night rule. */
export function offStops(level: number): number {
  const l = level > 1e-12 ? level : 1e-12;
  return kneeStops(Math.log2(OFF_LEVEL_REF / l));
}

/** The player's Exposure (stops, -2 to 2) as the output's factor. */
export function compensationOf(stops: number): number {
  const s = Number.isFinite(stops) ? (stops < -2 ? -2 : stops > 2 ? 2 : stops) : 0;
  return Math.pow(2, s);
}

/**
 * The eye's whole frame as the card works it, from a histogram: the target after the dark-night rule, the ease from `prev`,
 * and what the buffer holds, into `out` (`EYE_SLOT`'s places). The node test and the console's check run it; the card's
 * adapting pass is this, line for line.
 */
export function eyeFrame(hist: ArrayLike<number>, prev: number, dt: number, snap: boolean, out: { [i: number]: number }): void {
  const pm = [0, 0];
  percentileMean(hist, pm);
  const have = pm[0] === pm[0];
  const mean = have ? pm[0] : out[EYE_SLOT.mean];
  const m = fullStops(mean);
  const target = kneeStops(m);
  const eased = snap ? target : easeStops(prev, target, dt);
  out[EYE_SLOT.stops] = eased;
  out[EYE_SLOT.target] = target;
  out[EYE_SLOT.mean] = mean;
  out[EYE_SLOT.full] = m;
  out[EYE_SLOT.weight] = pm[1];
  out[EYE_SLOT.exposure] = exposureOf(eased);
  out[EYE_SLOT.glow] = glowOf(eased);
}

/**
 * The dials moved as the console writes them (`{ tune: { intoLight: 0.4 } }`, or the tune itself): each held to its
 * range; words for anything held or refused.
 */
export function tuneEye(o: Record<string, unknown>): string[] {
  const said: string[] = [];
  const t = (o && typeof o === 'object' && 'tune' in o ? o.tune : o) as Record<string, unknown>;
  if (!t || typeof t !== 'object') return ['the eye takes { tune: { intoLight, intoDark, knee, share, most, centre, floor, glow } }'];
  for (const [k, v] of Object.entries(t)) {
    const r = (EYE_TUNE_RANGE as Record<string, readonly [number, number]>)[k];
    if (!r) {
      said.push(`${k}: no such dial`);
      continue;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      said.push(`${k}: not a number`);
      continue;
    }
    const held = v < r[0] ? r[0] : v > r[1] ? r[1] : v;
    if (held !== v) said.push(`${k}: held to ${held}`);
    (EYE_TUNE as Record<string, number>)[k] = held;
  }
  EYE_STATE.version++;
  return said;
}

/**
 * The frame's numbers the card's passes read (render-group uniforms in `eyeGpu.ts`, each handed back only when it moved), and
 * the CPU's own answer while the card does not adapt. Written by `EyeRun.frame`; the whole numbers are kept whole (a time in
 * microseconds, flags 0 and 1), so a frame hands nothing new to three.
 */
export const EYE_FRAME = {
  /** The frame's time in whole microseconds (held to a quarter second). */
  dtUs: 16667,
  /** 1 while a loading screen stands (the eye taken at once), else 0. */
  snap: 1,
  /** 1 while the card measures and adapts this frame, else 0 (the CPU's answer stands in the buffer). */
  adapting: 0,
};
