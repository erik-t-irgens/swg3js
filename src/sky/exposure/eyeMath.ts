// The eye (the GPU port's pass 2, wave 2; the design's 2.8; its curve made his demo's in the sky and light fix round): how
// bright the picture is made, measured on the card each frame and eased like an eye, with a rule that keeps nights dark but
// readable. This file is the arithmetic, pure (no three, no DOM), so a node test runs it; the card's two compute passes
// (`eyeGpu.ts`) do the very same sums in three's shading language, every number read from the tables here, and
// `__debug.exposure({ check: true })` holds the card's answer to these functions over the histogram it read back.
//
// What it does, a frame (the owner's demo, `Feature-requests/Clouds and atmosphere — WebGPU demo.html`, its EXPOSURE_WGSL and
// HISTOGRAM_WGSL, line for line but for the units and the picture measured):
//   - **the measure**: a quarter-size copy of the scene (taken before the bloom) as each pixel's log2 luminance, counted into
//     `EYE_FIXED.bins` bins over `minLog` to `maxLog`, each pixel weighted toward the middle of the view (the demo's
//     `mix(4, 16, exp(-1.5 d²))`: `centre` 3, the middle four times the edges). The demo counts its bloom's quarter-size level
//     instead (a thirteen-tap down of a Karis-weighted thirteen-tap down); ours keeps the eye's own copy (`eyeGpu.ts`, four
//     bilinear taps a texel: a plain 4×4 average of the full picture), because the bloom (`gpuBloomMix.ts`) is not drawn
//     with the Bloom row off or its strength at Off, where the eye must still measure, and comes after the eye in the chain.
//     The two differ in how widely a texel is averaged before its log is taken (the demo's two downs reach wider, and its
//     Karis weight pulls a bright texel down), so ours sees a little more contrast; by how much was not measured;
//   - **the scene's brightness**: the mean log2 luminance of the counted weight between the 40th percentile and the top one
//     (`EYE_LIGHTS.top`, 0.96, maker L's dial in the same set), so the darkest corners and the sun, the sky's glare and a
//     lamp's core never steer it;
//   - **the demo's curve**: that mean held to [`low`, `high`] (the darkest and the brightest scene the eye adapts to), and
//     under the `knee` only `share` of each further stop made up; the exposure is `key / 2^adapted`, so a scene at the key's
//     brightness shows at the key (mid grey) on the screen;
//   - **the ease**: toward the target in stops, `1 − exp(−dt · rate)` of the way a frame, faster into light (`intoLight`
//     2.6/s) than into the dark (`intoDark` 1.1/s); at a loading screen it is taken at once (`snap`);
//   - **what it hands out**: the exposure `2^stops` (the output, the bloom's Karis weights and the grade read it) and the
//     glow factor `2^(-glow · stops)` the emissive things (sabers, lamps, bolts, city lights, every unlit surface) are drawn
//     with, so at `glow` 1 they look as they did at an exposure of 1 whatever the eye does.
//
// **The units.** The demo's scene is lit by a sun of illuminance 16 at the top of its air (its `ATMOSPHERE.sunIlluminance`);
// ours by `AIR_UNITS.scene` times the star's strength (1 for every world's caster) on a colour of luminance 1: 2.4287, the
// factor `airTwin.ts`'s `sceneUnits()` works at load (a clear Tatooine noon's sun lighting as today's key light of 1.903).
// So a scene of the demo's lights ours 2.4287 / 16 = 0.1518 as bright, log2 −2.7198 stops, and every absolute number of the
// demo's in log2 luminance (its clamp's −14 and 4, its knee's −2) is carried over by adding `EYE_DEMO.shift` (−2.7198):
// −16.72, 1.28 and −4.72. The key (0.18, mid grey on the screen), the share (0.7), the percentiles and the speeds are ratios
// and rates and carry over as they are. `eye.test.ts` holds `EYE_DEMO.ours` to `sceneUnits()`.
//
// The player's own Exposure (±2 stops, the Graphics page) is the output's, over all of it; "off" (the Eye adaptation row)
// follows the sun's height instead of measuring (`offStops`: the light on a level surface as a scene's brightness, through
// the same curve).
import { EYE_LIGHTS } from '../eyeLights.ts';

/** The demo's sun and ours at the top of the air, and the stops between them (the conversion above). */
export const EYE_DEMO = {
  /** The demo's sun's illuminance at the top of its air (`ATMOSPHERE.sunIlluminance`). */
  demo: 16,
  /** Ours: `AIR_UNITS.scene` (2.428696, `sceneUnits()`) times a caster's strength of 1 on a colour of luminance 1. */
  ours: 2.428696,
  /** log2(ours / demo): what each of the demo's absolute log2 luminances is moved by to stand in our scene's units. */
  shift: Math.log2(2.428696 / 16),
} as const;

/** A demo's log2 luminance in ours, to four places (a dial's start). */
const ourLog = (demoLog: number): number => Number((demoLog + EYE_DEMO.shift).toFixed(4));

/**
 * The eye's dials (the debug menu's `exposure` sliders and `__debug.exposure({ tune })`). Feel is the owner's: each starts at
 * his demo's value carried into our units (the file's head), with the reason beside it, and nobody tunes them by measuring.
 *   - `key` 0.18: the brightness the eye brings the scene's measured brightness to before the tone curve (the demo's `KEY`,
 *     mid grey). Higher is a brighter picture everywhere the eye adapts.
 *   - `low` −20.5: the darkest scene brightness the eye adapts to; anything darker is left darker, so a moonless night
 *     under a canopy stays black rather than lifted into grey noise. The lead's start of 22 November, with `share` 0.85:
 *     the demo's −14 in our units (−16.72) and 0.7 left every night black (Mos Eisley's moonlit street at 0.3 of 255,
 *     since our moonlit scenes are some four stops darker than the demo's darkest); these make up about 15 stops there,
 *     wave 2's dark but readable night. `EYE_DEMO_LOW` keeps the demo's own, for a line that puts it back.
 *   - `high` 1.28 (the demo's 4): the brightest it adapts to; anything brighter is left brighter.
 *   - `knee` −4.72 (the demo's −2): below this scene brightness only `share` of each further stop of darkness is made up, so
 *     dusk still reads as dusk and a night as a night instead of a grey noon.
 *   - `share` 0.85 (the demo's 0.7; see `low`): the share of each stop below the knee made up.
 *   - `intoLight` 2.6 per second (the demo's): the ease's rate toward a brighter scene; out of the cantina into the noon street
 *     the glare is 93% settled within a second (the design's "the glare settles within 1 s").
 *   - `intoDark` 1.1 per second (the demo's): toward a darker one, slower, as an eye is; in from the street the room is 89%
 *     made up within two seconds (the design's "the room reads within about 2 s").
 *   - `centre` 3: the middle of the view's extra weight in the count (the demo's 4 at the edges and 16 at the middle: three
 *     times more), falling off as `exp(−1.5 d²)` across the view, so what is looked at steers the eye more than the edges.
 *   - `glow` 1: the emissive things' compensation (the design's "set for an exposure of 1"; the demo has no emissives): at 1 a
 *     saber, a lamp, a bolt or a lit window looks as it did at an exposure of 1 however far the eye has opened; at 0 it takes
 *     the eye's exposure like everything else.
 */
export const EYE_TUNE = { key: 0.18, low: -20.5, high: ourLog(4), knee: ourLog(-2), share: 0.85, intoLight: 2.6, intoDark: 1.1, centre: 3, glow: 1 };

/** The demo's own night (its clamp's −14 in our units, its share 0.7): `__debug.exposure({ tune: EYE_DEMO_NIGHT })` puts it back. */
export const EYE_DEMO_NIGHT = { low: ourLog(-14), share: 0.7 };

/** The dials' ranges (the sliders' and the console's alike), each inside the count's range of log2 luminance. */
export const EYE_TUNE_RANGE: { readonly [K in keyof typeof EYE_TUNE]: readonly [number, number] } = {
  key: [0.02, 1],
  low: [-25, 0],
  high: [-6, 9],
  knee: [-25, 9],
  share: [0, 1],
  intoLight: [0.1, 20],
  intoDark: [0.05, 20],
  centre: [0, 12],
  glow: [0, 1],
};

/**
 * What is not a dial: the count's layout and the guards.
 *   - `bins` 256 over `minLog` −26 to `maxLog` 10 (log2 of the scene's luminance): 36 stops, a seventh of a stop a bin. The
 *     demo counts 22 stops (−16 to 6, −18.7 to 3.3 in ours); ours reaches past every dial's range (a moonlit sky's 1e-7 is
 *     −23), so moving `low` or `high` never runs into the count's own ends.
 *   - `bottom` 0.4: the percentile the mean is taken from (the demo's 40th); its top is maker L's `EYE_LIGHTS.top` (0.96).
 *   - `fall` 1.5: the centre weight's fall-off, `exp(−fall · d²)` with `d` the texel's place in the view, −1 to 1 each way
 *     (the demo's).
 *   - `unit` 4: one pixel's weight at the edges in the count's whole numbers (the demo's 4 to 16).
 *   - `least` −12 and `most` 24: the stops the eye's answer is held to whatever the dials say, the pre-exposure's own range
 *     (`preExpose.ts`), so a dial moved to its end can never zero or overflow the scene's store.
 */
export const EYE_FIXED = { bins: 256, minLog: -26, maxLog: 10, bottom: 0.4, fall: 1.5, unit: 4, least: -12, most: 24 };

/**
 * The anchor of "off" (the eye not measuring, following the sun's height): the light on a level surface under today's clear
 * Tatooine noon's sun alone, its key light (`TODAY_NOON_KEY`, 1.903) times the sine of its 67.5 degrees.
 */
export const OFF_LEVEL_REF = 1.903 * Math.sin((67.5 * Math.PI) / 180);

/**
 * "Off" takes a scene's brightness as the light on a level surface times this: wave 2's anchor, Mos Eisley's street at a
 * clear noon measuring a mean luminance of 0.39 under a level light of `OFF_LEVEL_REF` (its 0.5425 under the air's noon, 1.39
 * times that light), so the row off and the eye on agree in the street at noon.
 */
export const OFF_MEAN = 0.39 / OFF_LEVEL_REF;

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
 * A pixel's weight in the count's whole numbers, at `px`, `py` its place in the view (−1 to 1 each way): the demo's
 * `round(mix(4, 16, exp(−1.5 d²)))` at `centre` 3, `unit · (1 + centre · exp(−fall · d²))` rounded as the card rounds it
 * (`floor(w + 0.5)`).
 */
export function weightAt(px: number, py: number): number {
  const F = EYE_FIXED;
  const w = F.unit * (1 + EYE_TUNE.centre * Math.exp(-F.fall * (px * px + py * py)));
  return Math.floor(w + 0.5);
}

/**
 * The mean log2 luminance of the count between the `bottom` and the top percentile (`EYE_LIGHTS.top`; each bin at its middle,
 * a bin cut by a percentile counted by the share inside), into `out[0]`, and the count's whole weight into `out[1]`. `out[0]`
 * is NaN when nothing was counted.
 */
export function percentileMean(hist: ArrayLike<number>, out: { [i: number]: number }): void {
  const F = EYE_FIXED;
  let total = 0;
  for (let i = 0; i < F.bins; i++) total += hist[i];
  const top = Math.max(EYE_LIGHTS.top, F.bottom);
  const lo = total * F.bottom;
  const hi = total * top;
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

/** The full make-up, in stops: what brings a scene of mean log2 luminance `mean` to the key with no rule at all. */
export function fullStops(mean: number): number {
  return Math.log2(EYE_TUNE.key) - mean;
}

/**
 * The kept numbers a frame's rule works through (`EK[0]` the scene's mean log2 luminance in, `EK[1]` the target stops out): a
 * number handed to or back from a call the compiler leaves out is a number made (CLAUDE.md), so the main thread's frame calls
 * `kneeInto` with nothing across the call.
 */
export const EK = new Float64Array(2);

/**
 * The demo's curve from `EK[0]` into `EK[1]` (`targetStops`'s body): the mean held to [low, high], below the knee only `share`
 * of each further stop (`max(c, knee) + share · min(c − knee, 0)`, the demo's `select` written with no branch), the stops that
 * bring it to the key, held to the guards. Written with `Math.max` and `Math.min` and no conditional write of a dial's number
 * into a local: that form boxed the number on every call (16 B a frame in one process in two, `eyeAlloc.test.ts`; the crowd's
 * lesson in `performance.md`).
 */
export function kneeInto(): void {
  const T = EYE_TUNE;
  const c = Math.min(Math.max(EK[0], T.low), T.high);
  const p = Math.max(c, T.knee) + T.share * Math.min(c - T.knee, 0);
  const s = Math.log2(T.key) - p;
  EK[1] = Math.max(Math.min(s, EYE_FIXED.most), EYE_FIXED.least);
}

/** The demo's curve: the stops the eye makes up for a scene of mean log2 luminance `mean` (its target). */
export function targetStops(mean: number): number {
  EK[0] = mean;
  kneeInto();
  return EK[1];
}

/** The ease's rate this frame: toward a brighter scene (fewer stops) `intoLight`, toward a darker one `intoDark`, per second. */
function rateOf(prev: number, target: number): number {
  return target < prev ? EYE_TUNE.intoLight : EYE_TUNE.intoDark;
}

/** One frame's ease from `prev` toward `target` stops over `dt` seconds: `1 − exp(−dt · rate)` of the way (the demo's). */
export function easeStops(prev: number, target: number, dt: number): number {
  const k = 1 - Math.exp(-(dt > 0 ? dt : 0) * rateOf(prev, target));
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

/** The log2 brightness "off" takes for a scene lit by `level` on a level surface (scene units). */
export function offMeanOf(level: number): number {
  const l = level > 1e-12 ? level : 1e-12;
  return Math.log2(l * OFF_MEAN);
}

/** The stops "off" makes up for a light of `level` on a level surface (scene units), through the same curve. */
export function offStops(level: number): number {
  return targetStops(offMeanOf(level));
}

/** The player's Exposure (stops, -2 to 2) as the output's factor. */
export function compensationOf(stops: number): number {
  const s = Number.isFinite(stops) ? (stops < -2 ? -2 : stops > 2 ? 2 : stops) : 0;
  return Math.pow(2, s);
}

/**
 * The eye's whole frame as the card works it, from a histogram: the target by the demo's curve, the ease from `prev`, and
 * what the buffer holds, into `out` (`EYE_SLOT`'s places). The node test and the console's check run it; the card's adapting
 * pass is this, line for line.
 */
export function eyeFrame(hist: ArrayLike<number>, prev: number, dt: number, snap: boolean, out: { [i: number]: number }): void {
  const pm = [0, 0];
  percentileMean(hist, pm);
  const have = pm[0] === pm[0];
  const mean = have ? pm[0] : out[EYE_SLOT.mean];
  const target = targetStops(mean);
  const eased = snap ? target : easeStops(prev, target, dt);
  out[EYE_SLOT.stops] = eased;
  out[EYE_SLOT.target] = target;
  out[EYE_SLOT.mean] = mean;
  out[EYE_SLOT.full] = fullStops(mean);
  out[EYE_SLOT.weight] = pm[1];
  out[EYE_SLOT.exposure] = exposureOf(eased);
  out[EYE_SLOT.glow] = glowOf(eased);
}

/**
 * The dials moved as the console writes them (`{ tune: { intoLight: 2 } }`, or the tune itself): each held to its range;
 * words for anything held or refused.
 */
export function tuneEye(o: Record<string, unknown>): string[] {
  const said: string[] = [];
  const t = (o && typeof o === 'object' && 'tune' in o ? o.tune : o) as Record<string, unknown>;
  if (!t || typeof t !== 'object') return [`the eye takes { tune: { ${Object.keys(EYE_TUNE).join(', ')} } }`];
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
